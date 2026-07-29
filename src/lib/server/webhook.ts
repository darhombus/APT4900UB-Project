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
	'received' | 'ignored_invalid' | 'ignored_unhandled' | 'ignored_unmatched';

export interface WebhookAuditRow {
	paystack_reference: string | null;
	event_type: string;
	signature_valid: boolean;
	/** Matches the `payload jsonb not null` column on `payments`. */
	payload: Json;
	processing_outcome: WebhookOutcome;
}

export interface WebhookDeps {
	paystack: Pick<PaystackClient, 'verifyWebhookSignature'>;
	/** Appends one row to the payments audit trail. Service-role only (D9). */
	recordAudit(row: WebhookAuditRow): Promise<void>;
	/** Hands the reference to the Inngest function that does the real work. */
	sendPaymentEvent(input: { reference: string; eventType: string }): Promise<void>;
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
