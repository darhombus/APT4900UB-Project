import { MIN_PAYOUT_KES_CENTS, computeInstantPayoutFee } from '$lib/server/payout-constants';

/**
 * The instant-withdrawal decision, as a pure function
 * (Payouts PRD — Section 6; decisions P6, P10, P11, assumption A1).
 *
 * Extracted for the same reason `decidePayment` is: the rule is worth testing
 * exhaustively without a database, and keeping it out of the form action stops
 * the action from growing a second, subtly different copy later.
 *
 * A1 — there is no amount input. A withdrawal always takes the FULL available
 * balance, so the only inputs are the balance and whether a recipient exists.
 */

export type PayoutRejection = 'below_minimum' | 'no_recipient' | 'in_flight';

export type PayoutRequestDecision =
	| {
			action: 'create';
			/** Gross: the full available balance (A1). */
			amountKesCents: number;
			/** The 1% instant fee, floored (P11). */
			feeKesCents: number;
			/** What actually reaches the seller. */
			netKesCents: number;
			recipientCode: string;
	  }
	| { action: 'reject'; rejection: PayoutRejection };

/**
 * Seller-facing text for each rejection. Distinct per case on purpose: "that
 * didn't work" tells a seller nothing about whether to add a number, earn more,
 * or simply wait.
 */
export const PAYOUT_REJECTION_MESSAGES: Record<PayoutRejection, string> = {
	below_minimum: `You need at least KES ${MIN_PAYOUT_KES_CENTS / 100} available to withdraw.`,
	no_recipient: 'Add your Mpesa number before withdrawing.',
	in_flight: 'A payout is already in progress. You can withdraw again once it finishes.'
};

/**
 * Decide whether a withdrawal can be created.
 *
 * Validation order follows Section 6: balance, then recipient. In-flight is NOT
 * decided here — the partial unique index on payouts(seller_id) is the
 * authoritative guard (P10), and a pre-check would only ever be advisory, since
 * a concurrent request can slip between the check and the insert. The caller
 * catches the unique violation instead; see `isInFlightViolation`.
 */
export function decidePayoutRequest(input: {
	availableKesCents: number;
	recipientCode: string | null | undefined;
}): PayoutRequestDecision {
	if (input.availableKesCents < MIN_PAYOUT_KES_CENTS) {
		return { action: 'reject', rejection: 'below_minimum' };
	}

	if (!input.recipientCode) {
		return { action: 'reject', rejection: 'no_recipient' };
	}

	const feeKesCents = computeInstantPayoutFee(input.availableKesCents);

	return {
		action: 'create',
		amountKesCents: input.availableKesCents,
		feeKesCents,
		netKesCents: input.availableKesCents - feeKesCents,
		recipientCode: input.recipientCode
	};
}

/**
 * Is this insert error the in-flight guard firing?
 *
 * 23505 is Postgres' unique_violation. Matching the index name as well keeps a
 * future unique constraint on the same table (the transfer reference, say) from
 * being reported to the seller as "a payout is already in progress".
 */
export function isInFlightViolation(error: { code?: string; message?: string } | null): boolean {
	if (!error) return false;
	return (
		error.code === '23505' && (error.message ?? '').includes('payouts_one_in_flight_per_seller')
	);
}
