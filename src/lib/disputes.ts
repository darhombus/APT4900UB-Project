/**
 * Dispute presentation helpers (Admin Dashboard PRD — ADM-1, Section 6).
 *
 * Pure, and deliberately shared by BOTH parties' views: the buyer sees a
 * dispute on their order page and the seller sees the same dispute on their
 * sales list, and the two must not describe it differently. Same reasoning as
 * $lib/notifications — one place turns a status into words.
 *
 * Nothing here decides anything. The RPCs own every transition (ADM-7).
 */

/** The four ADM-1 states, matching `disputes_status_check` exactly. */
export const DISPUTE_STATUSES = [
	'open',
	'under_review',
	'resolved_refunded',
	'resolved_rejected'
] as const;

export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export function isDisputeStatus(value: string): value is DisputeStatus {
	return (DISPUTE_STATUSES as readonly string[]).includes(value);
}

/** The order states a dispute can be opened from, per `open_dispute`'s body. */
export const DISPUTE_ELIGIBLE_ORDER_STATUSES = ['paid', 'completed'] as const;

/**
 * Whether a dispute is still running.
 *
 * The same two states ADM-11 holds payouts on, and the same two the partial
 * unique index treats as "live" — so a live dispute is exactly one that blocks
 * opening another.
 */
export function isDisputeLive(status: string): boolean {
	return status === 'open' || status === 'under_review';
}

/**
 * ADM-15 — the dispute states that stop an order counting toward seller
 * earnings. THE TYPESCRIPT MIRROR OF `public.order_earnings_blocked(uuid)`.
 *
 *   open, under_review   held while the claim is live (ADM-11)
 *   resolved_refunded    held PERMANENTLY — the buyer has their money back and
 *                        nothing else deducts it (ADM-15)
 *   resolved_rejected    absent on purpose: no money moved, so the hold lifts
 *
 * TWO DEFINITIONS EXIST, AND THAT IS DELIBERATE. The money path is SQL (the
 * balance functions call the helper); the display readers are TypeScript and
 * need per-order flags to SHOW the held amount rather than silently drop it, so
 * they classify rows they have already fetched instead of making one round trip
 * per order. What stops the two drifting is not this comment: a db test
 * (adm15-earnings-agreement) drives the SQL helper through all four dispute
 * states and asserts it agrees with this list on every one, so a one-sided edit
 * fails loudly.
 */
export const EARNINGS_BLOCKING_DISPUTE_STATUSES = [
	'open',
	'under_review',
	'resolved_refunded'
] as const;

/** True when this dispute status stops its order counting toward earnings. */
export function blocksEarnings(status: string): boolean {
	return (EARNINGS_BLOCKING_DISPUTE_STATUSES as readonly string[]).includes(status);
}

/**
 * Why an order's earnings are withheld, for the two display readers.
 *
 * `held` is temporary and will resolve one way or the other; `refunded` is
 * final. They are separated because the seller is owed different words: money
 * coming back versus money gone.
 */
export type EarningsBlock = 'held' | 'refunded' | null;

export function earningsBlockFor(statuses: readonly string[]): EarningsBlock {
	// Refunded wins: it is permanent, so it is the honest thing to say even if a
	// later dispute on the same order is somehow live.
	if (statuses.includes('resolved_refunded')) return 'refunded';
	if (statuses.some((s) => s === 'open' || s === 'under_review')) return 'held';
	return null;
}

/** Matches the DB CHECK on `disputes.reason` so a bad length fails inline. */
export const DISPUTE_REASON_MIN = 10;
export const DISPUTE_REASON_MAX = 2000;

export function parseDisputeReason(raw: FormDataEntryValue | null): {
	ok: boolean;
	value: string;
	error?: string;
} {
	const value = String(raw ?? '').trim();
	if (value.length < DISPUTE_REASON_MIN) {
		return {
			ok: false,
			value,
			error: `Please describe the problem in at least ${DISPUTE_REASON_MIN} characters.`
		};
	}
	if (value.length > DISPUTE_REASON_MAX) {
		return {
			ok: false,
			value,
			error: `Please keep this to ${DISPUTE_REASON_MAX} characters or fewer.`
		};
	}
	return { ok: true, value };
}

export interface DisputeStatusView {
	label: string;
	/** Badge variant from the shared UI foundation. */
	variant: 'warning' | 'brand' | 'success' | 'neutral';
}

const STATUS_VIEW: Record<DisputeStatus, DisputeStatusView> = {
	open: { label: 'Open', variant: 'warning' },
	under_review: { label: 'Under review', variant: 'brand' },
	resolved_refunded: { label: 'Refunded', variant: 'success' },
	resolved_rejected: { label: 'Closed', variant: 'neutral' }
};

export function disputeStatusView(status: string): DisputeStatusView {
	return isDisputeStatus(status) ? STATUS_VIEW[status] : { label: status, variant: 'neutral' };
}

/**
 * One line of plain explanation, written for the party reading it.
 *
 * `resolved_rejected` is labelled "Closed" rather than "Rejected" — the outcome
 * is that no refund was issued, and "rejected" reads as a judgement on the
 * person rather than on the claim.
 */
export function disputeSummary(status: string, role: 'buyer' | 'seller'): string {
	switch (status) {
		case 'open':
			return role === 'buyer'
				? 'You reported a problem with this order. Our team will look into it.'
				: 'The buyer reported a problem with this order. Our team will look into it. Your earnings from this order are on hold until it is settled.';
		case 'under_review':
			return role === 'buyer'
				? 'Our team is looking into this now. You will hear from us once there is a decision.'
				: 'Our team is looking into this now. Your earnings from this order stay on hold until it is settled.';
		case 'resolved_refunded':
			return role === 'buyer'
				? 'This was settled with a refund. It goes back the same way you paid.'
				: 'This was settled with a refund to the buyer. The earnings from this order will not be paid out.';
		case 'resolved_rejected':
			return role === 'buyer'
				? 'We reviewed this and did not issue a refund.'
				: 'This was closed without a refund. Your earnings from this order are no longer on hold.';
		default:
			return '';
	}
}

export interface DisputeTimelineStep {
	label: string;
	at: string | null;
	done: boolean;
}

/**
 * Opened → under review → settled.
 *
 * NO `under_review_at` COLUMN EXISTS, so that step can be shown as reached but
 * never with a timestamp — the PRD asks for a timeline "if available" and this
 * is the honest reading of what the schema stores. Section 6 adds no migration,
 * so the column is not invented here; a dated middle step would need one.
 */
export function disputeTimeline(dispute: {
	status: string;
	created_at: string;
	resolved_at: string | null;
}): DisputeTimelineStep[] {
	const resolved = dispute.status.startsWith('resolved_');
	return [
		{ label: 'Reported', at: dispute.created_at, done: true },
		{
			label: 'Under review',
			at: null,
			done: dispute.status === 'under_review' || resolved
		},
		{
			label: 'Settled',
			at: dispute.resolved_at,
			done: resolved
		}
	];
}
