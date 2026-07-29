import { PAYSTACK_CURRENCY, type VerifyResult } from '$lib/server/paystack';

/**
 * The verify → decision rule, as a pure function (Checkout PRD — Section 6).
 *
 * Extracted deliberately: Section 8's callback page runs the SAME decision on
 * the same inputs, and D10 only makes the double path safe if both sides agree
 * on what a verify response means. One implementation, two callers.
 *
 * Nothing here touches the database, Paystack, or Inngest — given a verify
 * response and the matching order row, it returns what should happen next.
 */

/** The order fields the decision needs. Anything else is irrelevant to it. */
export interface DecisionOrder {
	id: string;
	status: string;
	amount_total: number;
}

export type PaymentDecision =
	/** Verified, amounts agree — call finalize_order_payment. */
	| { action: 'finalize'; amountCents: number; outcome: 'finalized' }
	/** Already terminal on our side; nothing to do (D10). */
	| { action: 'noop'; outcome: 'noop_already_paid' }
	/** Business-terminal: record it and stop. Never retried. */
	| {
			action: 'stop';
			outcome: 'verify_failed' | 'ignored_unmatched' | 'ignored_amount_mismatch';
			reason: string;
	  };

/**
 * Decide from a verify response plus the order we hold for that reference.
 *
 * Every outcome here is BUSINESS-terminal — a failed charge, an unknown
 * reference, a wrong amount. None of them is retryable, so the caller returns
 * normally rather than throwing. Infrastructure failures (network, database)
 * never reach this function; they throw before it and Inngest retries those.
 */
export function decidePayment(
	verify: VerifyResult | null,
	order: DecisionOrder | null
): PaymentDecision {
	// D4 — Paystack's own verify is the source of truth, not the webhook payload.
	if (!verify || verify.status !== 'success') {
		return {
			action: 'stop',
			outcome: 'verify_failed',
			reason: `verify status ${verify?.status ?? 'unavailable'}`
		};
	}

	if (!order) {
		// A reference we never issued, or whose order is gone. Stage-dependent
		// meaning: at verify time this means "no matching order" (R-11).
		return {
			action: 'stop',
			outcome: 'ignored_unmatched',
			reason: `no order for reference ${verify.reference}`
		};
	}

	// Idempotency (D10): the webhook and the callback both run this path, and
	// re-delivery is normal. Whoever arrives second finds the order already
	// terminal and does nothing — which is a success, not an error.
	if (order.status === 'paid' || order.status === 'completed') {
		return { action: 'noop', outcome: 'noop_already_paid' };
	}

	if (verify.currency !== PAYSTACK_CURRENCY) {
		return {
			action: 'stop',
			outcome: 'ignored_amount_mismatch',
			reason: `currency ${verify.currency} is not ${PAYSTACK_CURRENCY}`
		};
	}

	// Exact match only. A payment for the wrong amount is never finalised —
	// under-payment would hand over goods that weren't paid for, and
	// over-payment needs a refund path this phase deliberately does not have.
	if (verify.amountCents !== order.amount_total) {
		return {
			action: 'stop',
			outcome: 'ignored_amount_mismatch',
			reason: `verified ${verify.amountCents} != order ${order.amount_total}`
		};
	}

	// Anything other than pending_payment at this point (cancelled, expired) must
	// not be quietly converted into a sale.
	if (order.status !== 'pending_payment') {
		return {
			action: 'stop',
			outcome: 'ignored_unmatched',
			reason: `order ${order.id} is ${order.status}, not pending_payment`
		};
	}

	return { action: 'finalize', amountCents: verify.amountCents, outcome: 'finalized' };
}
