/**
 * Seller payout constants and money helpers (Payouts PRD — Section 2).
 *
 * A NEW module, deliberately. The Section 1 survey confirmed there is no
 * existing constants module to extend: the platform commission lives only as the
 * SQL literal `round(v_order.amount_total * 0.05)` inside `finalize_order_payment`,
 * which its own migration comment declares authoritative because D6 requires the
 * split to be computed inside the finalising transaction.
 *
 * That rate is therefore NOT mirrored here (PR-2). Nothing in this file computes
 * commission; a second copy of a rate that the database owns is exactly the drift
 * this phase is avoiding.
 *
 * Every amount is integer KES cents. No float ever reaches a stored value (D8).
 */

import { readRuntimeEnv } from '$lib/server/runtime-env';

/** P4 — funds become available this many days after `completed_at`. */
export const PAYOUT_HOLD_DAYS = 2;

/**
 * Section 4A — days after `paid_at` before an unconfirmed order auto-completes.
 *
 * Without this, a buyer who never presses "confirm receipt" strands the seller's
 * money permanently: `completed` is the only payout-eligibility trigger (PR-4),
 * so the 2-day hold would never even start. Worst case from payment to
 * withdrawable is AUTO_COMPLETE_DAYS + PAYOUT_HOLD_DAYS = 9 days.
 */
export const AUTO_COMPLETE_DAYS = 7;

/** P5 — the instant-withdrawal fee, in basis points. 100 bps = 1%. */
export const INSTANT_PAYOUT_FEE_BPS = 100;

/** P6 — KES 100. A hard floor for instant withdrawals; the weekly sweep skips below it. */
export const MIN_PAYOUT_KES_CENTS = 10_000;

/** A2 — Mondays 06:00 UTC, which is 09:00 EAT. */
export const WEEKLY_SWEEP_CRON = '0 6 * * 1';

/**
 * The auto-completion window as an Inngest duration string (Section 4A).
 *
 * Read at execution time inside the handler, never at import, so a test can
 * shorten it without a rebuild — exactly how expire-order reads
 * `orderHoldDuration()`. AUTO_COMPLETE_DAYS_OVERRIDE accepts a fractional number
 * of days and is for local tests ONLY; it must stay unset on every Vercel tier,
 * so production always waits the full 7 days.
 *
 * Sub-day values become seconds so a fast local run doesn't wait out a day.
 * Anything non-numeric or non-positive falls back to the default rather than
 * producing a zero-length window, which would complete orders the instant they
 * were paid — the precise failure the SQL predicate in auto_complete_order
 * exists to catch independently.
 */
export function autoCompleteDuration(): string {
	const raw = readRuntimeEnv('AUTO_COMPLETE_DAYS_OVERRIDE');
	const parsed = raw === undefined || raw.trim() === '' ? AUTO_COMPLETE_DAYS : Number(raw);

	const days = Number.isFinite(parsed) && parsed > 0 ? parsed : AUTO_COMPLETE_DAYS;
	if (!Number.isFinite(parsed) || parsed <= 0) {
		if (raw !== undefined && raw.trim() !== '') {
			console.warn(
				'[payouts] ignoring AUTO_COMPLETE_DAYS_OVERRIDE=%s (not a positive number); using %d days',
				raw,
				AUTO_COMPLETE_DAYS
			);
		}
	}

	if (days >= 1) return `${days}d`;
	return `${Math.max(1, Math.round(days * 86_400))}s`;
}

/** Basis points are per ten-thousand; named so the arithmetic below reads as intended. */
const BPS_DIVISOR = 10_000;

function assertPayoutAmount(amountKesCents: number): void {
	if (!Number.isSafeInteger(amountKesCents) || amountKesCents < 0) {
		throw new Error(
			`Payout amount must be a non-negative safe integer of KES cents; got ${amountKesCents}. ` +
				`Money is integer cents end to end (D8) — never a float.`
		);
	}
}

/**
 * The 1% instant-withdrawal fee, FLOORED (P11, A3).
 *
 * Floor, not the half-up rounding `finalize_order_payment` uses for commission.
 * The divergence is intentional and must not be "unified": flooring rounds in the
 * SELLER's favour, so a sub-cent remainder is never charged to them. Commission
 * is the platform taking its cut and rounds half up; this is the platform taking
 * a convenience fee and rounds down. Different direction, different rule.
 */
export function computeInstantPayoutFee(amountKesCents: number): number {
	assertPayoutAmount(amountKesCents);
	return Math.floor((amountKesCents * INSTANT_PAYOUT_FEE_BPS) / BPS_DIVISOR);
}

/** What actually reaches the seller: the gross minus the floored fee. */
export function computeInstantPayoutNet(amountKesCents: number): number {
	return amountKesCents - computeInstantPayoutFee(amountKesCents);
}

/**
 * Both halves at once, for callers that render the fee and the net together —
 * the withdrawal form shows both beside the button (Section 6), and computing
 * them from one call keeps them provably consistent.
 */
export function splitInstantPayout(amountKesCents: number): {
	gross: number;
	fee: number;
	net: number;
} {
	const fee = computeInstantPayoutFee(amountKesCents);
	return { gross: amountKesCents, fee, net: amountKesCents - fee };
}
