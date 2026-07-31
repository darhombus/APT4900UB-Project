import type { PaystackClient } from '$lib/server/paystack';
import type { Json } from '$lib/types/database';

/**
 * Paystack webhook decision logic (Checkout PRD — Section 5), kept separate from
 * the route so it is testable without a server, a database, or Inngest.
 *
 * The handler's whole job is: authenticate the delivery, leave exactly one audit
 * row, and hand real work to Inngest. It performs NO order mutation, NO Paystack
 * verify call, and nothing else slow — Paystack times out webhooks, and D4's
 * second verification happens in the Inngest function (Section 6) where a retry
 * is cheap.
 */

/** The `processing_outcome` vocabulary this handler can write (see the migration). */
export type WebhookOutcome =
	| 'received'
	| 'ignored_invalid'
	| 'ignored_unhandled'
	| 'ignored_unmatched'
	// Payouts Section 8 — transfer events. Distinct values so the audit trail
	// tells a verified transition apart from one refused by the verify or by the
	// transition graph.
	| 'transfer_applied'
	| 'transfer_verify_mismatch'
	| 'transfer_out_of_order'
	| 'transfer_unmatched';

export interface WebhookAuditRow {
	paystack_reference: string | null;
	event_type: string;
	signature_valid: boolean;
	/** Matches the `payload jsonb not null` column on `payments`. */
	payload: Json;
	processing_outcome: WebhookOutcome;
}

/**
 * Payout-side dependencies (Payouts PRD — Section 8).
 *
 * Separate from the charge deps and OPTIONAL on purpose: when they are absent a
 * transfer event falls through to the pre-existing `ignored_unhandled` path,
 * which is exactly what this handler did before this phase. Every charge test
 * therefore keeps passing unchanged, and the charge path is untouched whether or
 * not payouts are wired.
 */
export interface TransferWebhookDeps {
	/** P8's direct verify. Must agree with the webhook before any terminal transition. */
	verifyTransfer(reference: string): Promise<{ status: string } | null>;
	findPayoutByReference(reference: string): Promise<{ id: string; status: string } | null>;
	/** Calls transition_payout_status; THROWS when the transition graph refuses. */
	transitionPayout(payoutId: string, newStatus: string): Promise<void>;
}

export interface WebhookDeps {
	paystack: Pick<PaystackClient, 'verifyWebhookSignature'>;
	/** Appends one row to the payments audit trail. Service-role only (D9). */
	recordAudit(row: WebhookAuditRow): Promise<void>;
	/** Hands the reference to the Inngest function that does the real work. */
	sendPaymentEvent(input: { reference: string; eventType: string }): Promise<void>;
	/** Payouts Section 8. Absent → transfer events behave exactly as before. */
	payouts?: TransferWebhookDeps;
}

export interface WebhookResult {
	status: number;
	outcome: WebhookOutcome;
	/** True when the Inngest event was dispatched. */
	dispatched: boolean;
}

/** Parse without throwing; a hostile sender can put anything in the body. */
function parseJson(rawBody: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(rawBody);
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** Paystack nests the reference under `data`; absent on malformed deliveries. */
function readReference(body: Record<string, unknown> | null): string | null {
	const data = body?.data;
	if (!data || typeof data !== 'object') return null;
	const reference = (data as Record<string, unknown>).reference;
	return typeof reference === 'string' && reference ? reference : null;
}

/**
 * `rawBody` MUST be the exact bytes received. The signature is an HMAC over
 * those bytes, so verifying a re-serialised object (JSON.stringify of a parsed
 * body) would reject genuine deliveries whose key order or whitespace differs
 * from ours — the classic webhook signing bug.
 */
export async function handlePaystackWebhook(
	rawBody: string,
	signatureHeader: string | null | undefined,
	deps: WebhookDeps
): Promise<WebhookResult> {
	const signatureValid = deps.paystack.verifyWebhookSignature(rawBody, signatureHeader);

	const body = parseJson(rawBody);
	// Keep the original bytes when they aren't JSON, so the audit trail records
	// exactly what arrived rather than losing it.
	// Cast is sound: `body` came out of JSON.parse, and the fallback is a literal.
	// TS just can't carry that through Record<string, unknown>.
	const payload = (body ?? { raw: rawBody }) as Json;
	const eventType = typeof body?.event === 'string' ? body.event : 'unknown';
	const reference = readReference(body);

	if (!signatureValid) {
		// 200, deliberately, not 401. Two reasons, and both matter:
		//   - a probing sender learns nothing about whether they guessed the shape
		//   - Paystack retries non-2xx, and we do not want it retrying garbage
		// The audit row is the record that something unauthenticated arrived.
		await deps.recordAudit({
			paystack_reference: reference,
			event_type: eventType,
			signature_valid: false,
			payload,
			processing_outcome: 'ignored_invalid'
		});
		return { status: 200, outcome: 'ignored_invalid', dispatched: false };
	}

	// Payouts Section 8 — transfer events branch off HERE, before the charge
	// logic below, which is left exactly as it was. When `deps.payouts` is absent
	// this test is false and a transfer falls through to `ignored_unhandled`,
	// which is what happened before this phase existed.
	if (deps.payouts && TRANSFER_EVENTS.has(eventType)) {
		return handleTransferEvent(eventType, reference, payload, deps, deps.payouts);
	}

	// Signature is good. Decide the single outcome BEFORE writing, so every
	// delivery leaves exactly one row.
	let outcome: WebhookOutcome;
	if (eventType !== 'charge.success') {
		// Any other event (charge.failed, refunds, transfers…) is recorded and
		// dropped. A non-JSON body with a valid signature lands here too — it has
		// no event we can act on.
		outcome = 'ignored_unhandled';
	} else if (!reference) {
		// charge.success we cannot tie to an order is not actionable.
		outcome = 'ignored_unmatched';
	} else {
		outcome = 'received';
	}

	// Audit first: if the dispatch below fails, the record of the delivery
	// survives regardless.
	await deps.recordAudit({
		paystack_reference: reference,
		event_type: eventType,
		signature_valid: true,
		payload,
		processing_outcome: outcome
	});

	if (outcome !== 'received' || !reference) {
		return { status: 200, outcome, dispatched: false };
	}

	// Let a dispatch failure surface as a non-2xx so Paystack retries. Losing the
	// event would strand the payment until the buyer happened to return to the
	// callback page; a retry is safe because processing is idempotent by
	// reference (D10), and a duplicate audit row is correct for an audit trail.
	await deps.sendPaymentEvent({ reference, eventType });

	return { status: 200, outcome, dispatched: true };
}

/**
 * Transfer webhooks (Payouts PRD — Section 8; P8, P9).
 *
 * Each event names the transition it claims and the status the direct verify
 * must report for that claim to be believed. The webhook is a NOTIFICATION, not
 * an authority: nothing terminal happens until Paystack, asked directly,
 * confirms the same thing.
 */
const TRANSFER_EVENTS = new Map<string, { verified: string; from: string; to: string }>([
	['transfer.success', { verified: 'success', from: 'processing', to: 'success' }],
	['transfer.failed', { verified: 'failed', from: 'processing', to: 'failed' }],
	['transfer.reversed', { verified: 'reversed', from: 'success', to: 'reversed' }]
]);

/**
 * Handle one transfer event to a single outcome, always returning 200.
 *
 * 200 throughout is deliberate, as it is for the charge path: Paystack retries
 * non-2xx, and none of the outcomes here become correct by being retried. An
 * unknown reference stays unknown; a verify that disagrees will keep
 * disagreeing; a duplicate delivery is already applied.
 */
async function handleTransferEvent(
	eventType: string,
	reference: string | null,
	payload: Json,
	deps: WebhookDeps,
	payouts: TransferWebhookDeps
): Promise<WebhookResult> {
	const rule = TRANSFER_EVENTS.get(eventType)!;

	const finish = async (outcome: WebhookOutcome): Promise<WebhookResult> => {
		await deps.recordAudit({
			paystack_reference: reference,
			event_type: eventType,
			signature_valid: true,
			payload,
			processing_outcome: outcome
		});
		return { status: 200, outcome, dispatched: false };
	};

	// (a) No reference, or one we never issued. Log and 200 — erroring at Paystack
	// would earn us retries of a delivery we can never act on.
	if (!reference) {
		console.warn('[payouts] %s delivered with no reference', eventType);
		return finish('transfer_unmatched');
	}

	const payout = await payouts.findPayoutByReference(reference);
	if (!payout) {
		console.warn('[payouts] %s for unknown reference %s', eventType, reference);
		return finish('transfer_unmatched');
	}

	// (b) P8's double verification. The webhook says what happened; this asks
	// Paystack directly and requires the same answer. A forged or replayed body
	// that survived signature checking still cannot move money's status.
	const verified = await payouts.verifyTransfer(reference);

	if (!verified || verified.status !== rule.verified) {
		// LOUD: a mismatch is either a Paystack-side surprise or someone replaying
		// a stale body, and in both cases we deliberately do nothing.
		console.error(
			'[payouts] VERIFY MISMATCH for payout %s: webhook claimed %s (expects %s), Paystack reports %s. No action taken.',
			payout.id,
			eventType,
			rule.verified,
			verified?.status ?? 'unavailable'
		);
		return finish('transfer_verify_mismatch');
	}

	// (c)(d)(e) Verified. The transition graph decides whether this is legal from
	// the row's CURRENT status — which is what makes duplicate and out-of-order
	// deliveries safe without a separate seen-events table.
	try {
		await payouts.transitionPayout(payout.id, rule.to);
	} catch (err) {
		// (f) The graph refused: a duplicate transfer.success, a reversal for a
		// payout that never succeeded, an event arriving before its predecessor.
		// All are normal in a webhook world; none is an error to report upstream.
		console.info(
			'[payouts] %s for payout %s not applied (status was %s, wanted %s -> %s): %s',
			eventType,
			payout.id,
			payout.status,
			rule.from,
			rule.to,
			err instanceof Error ? err.message : String(err)
		);
		return finish('transfer_out_of_order');
	}

	console.info('[payouts] payout %s -> %s via %s (verified)', payout.id, rule.to, eventType);
	return finish('transfer_applied');
}
