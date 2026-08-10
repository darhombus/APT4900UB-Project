import type { VerifyResult } from '$lib/server/paystack';

/**
 * The verify → decision rule for a boost charge, as a pure function
 * (Boosts PRD — Section 3).
 *
 * Extracted for the same reason `decidePayment` is: TWO callers run it — the
 * Inngest function fed by the webhook, and the seller's callback page — and
 * BST-14's idempotency only holds if both agree on what a verify response means.
 * One implementation, two callers.
 *
 * Nothing here touches the database, Paystack or Inngest. Given a verify
 * response and the boosts row for that reference, it returns what happens next.
 */

/**
 * BST-14 — the reference namespace, and the routing predicate built on it.
 *
 * These live in this module rather than in `boosts.ts` for one reason: the
 * WEBHOOK handler branches on them, and `webhook.ts` is deliberately importable
 * without a database, a server or Inngest so its tests stay fast. `boosts.ts`
 * drags all three. This module imports nothing but a type.
 *
 * A CHECK constraint on `boosts.paystack_reference` enforces the same prefix, so
 * the namespace is a data-layer guarantee and not a convention this predicate
 * hopes holds.
 */
export const BOOST_REFERENCE_PREFIX = 'boost_';

/** True for references the boosts flow owns. Checkout's are `msk_`. */
export function isBoostReference(reference: string | null | undefined): boolean {
	return typeof reference === 'string' && reference.startsWith(BOOST_REFERENCE_PREFIX);
}

/** The boost fields the decision needs. Anything else is irrelevant to it. */
export interface DecisionBoost {
	id: string;
	status: string;
	/** WHOLE SHILLINGS (BST-3). See the conversion note on EXPECTED_MINOR_UNITS below. */
	price_kes_charged: number;
}

export type BoostDecision =
	/** Verified, amounts agree — call transition_boost_status(…, 'active'). */
	| { action: 'activate'; outcome: 'activated' }
	/** Paystack says the charge is definitively dead — mark the row failed (Section 3.2). */
	| { action: 'fail'; outcome: 'charge_failed'; reason: string }
	/** The row already reached a terminal state; nothing to do (BST-14 idempotency). */
	| { action: 'noop'; outcome: 'noop_already_settled' }
	/** Business-terminal or still-in-flight: record it and stop. Never retried. */
	| {
			action: 'stop';
			outcome: 'ignored_unmatched' | 'ignored_amount_mismatch' | 'verify_inconclusive';
			reason: string;
	  };

/**
 * Paystack statuses meaning the charge will definitively not succeed. Mirrors
 * the set the checkout callback page uses. `pending`/`ongoing` are still in
 * flight, and an ABSENT status means we could not ask — neither is a decline,
 * and neither may mark a seller's purchase failed.
 */
const DECLINED = new Set(['failed', 'abandoned', 'reversed']);

/**
 * THE ONE PLACE SHILLINGS BECOME MINOR UNITS ON THE VERIFY SIDE.
 *
 * `boost_packages.price_kes` and `boosts.price_kes_charged` are whole shillings
 * — the single exception to this project's integer-minor-units convention (D8),
 * specified by BST-3 and documented on the columns themselves. Paystack speaks
 * minor units, so exactly two places convert: the initialize call in boosts.ts,
 * and this comparison. Both multiply by the same constant, named here so a
 * reader can find the pair.
 *
 * Integer arithmetic throughout: price_kes is an integer column and 100 is an
 * integer, so this cannot produce a float and cannot drift.
 */
export const KES_MINOR_UNITS_PER_SHILLING = 100;

export function expectedMinorUnits(priceKes: number): number {
	return priceKes * KES_MINOR_UNITS_PER_SHILLING;
}

/**
 * Decide from a verify response plus the boosts row we hold for that reference.
 *
 * Every outcome is BUSINESS-terminal or a deliberate wait — none is retryable,
 * so the caller returns rather than throwing. Infrastructure failures (network,
 * database) never reach this function; they throw before it and Inngest retries.
 */
export function decideBoost(
	verify: VerifyResult | null,
	boost: DecisionBoost | null
): BoostDecision {
	if (!boost) {
		// A `boost_` reference we never issued. Unlike the order path this is
		// genuinely surprising — the namespace is ours and unique-indexed — so the
		// caller logs it rather than treating it as routine.
		return {
			action: 'stop',
			outcome: 'ignored_unmatched',
			reason: `no boost for reference ${verify?.reference ?? '(unknown)'}`
		};
	}

	// Idempotency (BST-14), checked BEFORE the verify is interpreted. A duplicate
	// webhook, a webhook racing the callback, or an Inngest retry all land here on
	// the second pass. transition_boost_status would refuse the transition anyway
	// — this returns the clean answer instead of relying on an exception.
	if (boost.status !== 'pending') {
		return { action: 'noop', outcome: 'noop_already_settled' };
	}

	if (!verify) {
		// Paystack positively told us the reference is not verifiable, or we could
		// not ask. NOT a decline: the row stays pending and a later delivery, or the
		// seller returning to the callback page, can still settle it. Marking it
		// failed here would strand a purchase that may yet succeed.
		return {
			action: 'stop',
			outcome: 'verify_inconclusive',
			reason: 'verify unavailable'
		};
	}

	if (DECLINED.has(verify.status)) {
		return {
			action: 'fail',
			outcome: 'charge_failed',
			reason: `verify status ${verify.status}`
		};
	}

	if (verify.status !== 'success') {
		// pending / ongoing — still in flight. Leave it alone.
		return {
			action: 'stop',
			outcome: 'verify_inconclusive',
			reason: `verify status ${verify.status}`
		};
	}

	const expected = expectedMinorUnits(boost.price_kes_charged);
	if (verify.amountCents !== expected) {
		// Loud at the call site. Either Paystack surprised us or someone paid a
		// tampered amount; either way no boost is granted.
		return {
			action: 'stop',
			outcome: 'ignored_amount_mismatch',
			reason: `expected ${expected} minor units, Paystack reported ${verify.amountCents}`
		};
	}

	return { action: 'activate', outcome: 'activated' };
}
