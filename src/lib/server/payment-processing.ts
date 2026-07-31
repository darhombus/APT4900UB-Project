import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '$lib/types/database';
import { PaystackApiError, type PaystackClient, type VerifyResult } from '$lib/server/paystack';
import { decidePayment, type PaymentDecision } from '$lib/server/payment-decision';
import { inngest, orderPaid } from '$lib/server/inngest';

/**
 * The verify-and-finalize path (Checkout PRD — Section 6), as ONE implementation.
 *
 * Both the Inngest function and Section 8's callback page run this. D10 makes the
 * double path safe only if the two agree on what a verify response means, so
 * they must not be two implementations that merely look alike.
 *
 * Every database touch here uses the SERVICE-ROLE client. `finalize_order_payment`
 * grants EXECUTE to service_role only (R-10), and `payments` grants nothing to any
 * client role (D9) — an anon/authenticated client would fail 42501 on both.
 */

export type ProcessOutcome =
	| 'finalized'
	| 'noop_already_paid'
	| 'verify_failed'
	| 'ignored_unmatched'
	| 'ignored_amount_mismatch';

export interface ProcessResult {
	outcome: ProcessOutcome;
	orderId: string | null;
	reason?: string;
	/**
	 * Paystack's transaction status, when we got an answer at all. Undefined
	 * means verify was unreachable or refused — which is NOT the same as a
	 * declined charge, and callers that render UI need to tell those apart:
	 * "your payment didn't go through" vs "we're still checking".
	 */
	verifyStatus?: string;
}

export interface ProcessDeps {
	paystack: Pick<PaystackClient, 'verifyTransaction'>;
	/** MUST be the service-role client (R-10). */
	admin: SupabaseClient<Database>;
	/**
	 * Emits `checkout/order.paid` (Payouts PRD — Section 4A, ruling PR-7).
	 * Optional: defaults to the real Inngest client, so neither existing caller
	 * has to change and neither can forget to wire it. Injectable for tests.
	 */
	sendOrderPaid?: (input: { orderId: string }) => Promise<void>;
}

/** The default emitter — the real Inngest client. */
async function emitOrderPaid(input: { orderId: string }): Promise<void> {
	await inngest.send(orderPaid.create(input));
}

/**
 * Verify with Paystack, deciding whether the failure is ours to retry.
 *
 * Returns null when Paystack positively tells us the reference is not
 * verifiable (a business-terminal answer). Re-throws anything else — bad key,
 * rate limit, outage, network — so Inngest retries it.
 */
async function verifyOrThrow(
	paystack: ProcessDeps['paystack'],
	reference: string
): Promise<VerifyResult | null> {
	try {
		return await paystack.verifyTransaction(reference);
	} catch (err) {
		if (err instanceof PaystackApiError && err.isTerminal) {
			console.warn('[payment] verify is terminal for %s: %s', reference, err.paystackMessage);
			return null;
		}
		throw err;
	}
}

/**
 * Append one audit row (D9). R-11 applies to every insert, not just the
 * webhook's: the outcome passed here is FINAL, because `service_role` holds no
 * UPDATE on `payments` and nothing can amend it afterwards.
 */
async function appendAudit(
	admin: SupabaseClient<Database>,
	row: {
		order_id: string | null;
		paystack_reference: string;
		event_type: string;
		payload: Json;
		processing_outcome: string;
	}
): Promise<void> {
	const { error } = await admin.from('payments').insert({
		...row,
		// Reached here only via a signature-verified webhook or our own callback,
		// both of which authenticated before calling.
		signature_valid: true
	});
	// Losing the audit trail is an infrastructure failure worth retrying.
	if (error) throw new Error(`payments audit insert failed: ${error.message}`);
}

/**
 * Process one Paystack reference to a terminal outcome.
 *
 * Business outcomes RETURN (never throw) — a failed charge, an unknown
 * reference, a wrong amount are all final answers, and retrying them just burns
 * attempts. Infrastructure failures THROW so the caller's retry policy applies.
 * That split is what Section 6's retry requirement asks for.
 */
export async function processPaymentReference(
	reference: string,
	deps: ProcessDeps
): Promise<ProcessResult> {
	const { paystack, admin } = deps;

	const verify = await verifyOrThrow(paystack, reference);

	// Load the order by OUR reference (D10's idempotency key).
	const { data: order, error: orderError } = await admin
		.from('orders')
		.select('id, status, amount_total')
		.eq('paystack_reference', reference)
		.maybeSingle();
	if (orderError) throw new Error(`order lookup failed: ${orderError.message}`);

	const decision: PaymentDecision = decidePayment(verify, order);
	const verifyPayload: Json = (verify?.raw as Json) ?? {
		error: 'verify_unavailable',
		reference
	};

	// Terminal without finalising: one row, final outcome, stop.
	if (decision.action === 'stop' || decision.action === 'noop') {
		const outcome = decision.action === 'noop' ? 'noop_already_paid' : decision.outcome;
		if (decision.action === 'stop' && decision.outcome === 'ignored_amount_mismatch') {
			// Loud on purpose: this is either a Paystack-side surprise or someone
			// paying a tampered amount, and it silently does nothing to the order.
			console.error(
				'[payment] AMOUNT MISMATCH for %s — %s. Order untouched.',
				reference,
				decision.reason
			);
		}
		await appendAudit(admin, {
			order_id: order?.id ?? null,
			paystack_reference: reference,
			event_type: 'verify',
			payload: verifyPayload,
			processing_outcome: outcome
		});
		return {
			outcome,
			orderId: order?.id ?? null,
			reason: decision.action === 'stop' ? decision.reason : undefined,
			verifyStatus: verify?.status
		};
	}

	// Verified and proceeding. This row records the verify snapshot itself; the
	// finalize row below records what the transition did.
	await appendAudit(admin, {
		order_id: order!.id,
		paystack_reference: reference,
		event_type: 'verify',
		payload: verifyPayload,
		processing_outcome: 'received'
	});

	// R-10: service-role only. finalize_order_payment revokes EXECUTE from anon
	// and authenticated, so this cannot be done with a user's client.
	const { data: finalized, error: finalizeError } = await admin.rpc('finalize_order_payment', {
		p_reference: reference,
		p_verified_amount: decision.amountCents
	});
	// Database trouble is infrastructure: throw and let the retry handle it.
	if (finalizeError) throw new Error(`finalize_order_payment failed: ${finalizeError.message}`);

	await appendAudit(admin, {
		order_id: order!.id,
		paystack_reference: reference,
		event_type: 'finalize',
		payload: (finalized as Json) ?? null,
		processing_outcome: 'finalized'
	});

	// PR-7 — start the 7-day auto-completion countdown (Section 4A). Emitted here
	// rather than in the Inngest function because THIS is the shared chokepoint:
	// the callback page finalises orders without any Inngest event of its own.
	//
	// Best-effort on purpose. Throwing would not help: on a retry `decidePayment`
	// sees the order already 'paid' and returns noop_already_paid, so this branch
	// is never re-entered and the event cannot be re-sent anyway. Throwing would
	// only add a failed run and, on the callback path, a 500 for a buyer whose
	// payment actually succeeded. The order IS paid either way; a lost event costs
	// the auto-completion backstop, not the payment.
	try {
		await (deps.sendOrderPaid ?? emitOrderPaid)({ orderId: order!.id });
	} catch (err) {
		console.error(
			'[payment] order %s finalised but checkout/order.paid failed to send: %s. ' +
				'Auto-completion will not be scheduled for this order.',
			order!.id,
			err instanceof Error ? err.message : String(err)
		);
	}

	return { outcome: 'finalized', orderId: order!.id, verifyStatus: verify?.status };
}
