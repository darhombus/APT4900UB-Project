/**
 * Order presentation helpers (Checkout PRD — Section 9). Pure, so the buyer
 * list, buyer detail and seller sales pages all describe a status identically.
 */

export type OrderStatus = 'pending_payment' | 'paid' | 'completed' | 'cancelled' | 'expired';

/** Badge tone per status, reusing the generic tones the design system already has. */
export type OrderBadgeVariant = 'warning' | 'success' | 'brand' | 'neutral';

/**
 * Buyer-facing wording. Deliberately describes what is true rather than naming
 * the enum: "Awaiting payment" tells a buyer what to do, `pending_payment`
 * doesn't.
 */
const LABELS: Record<OrderStatus, string> = {
	pending_payment: 'Awaiting payment',
	paid: 'Paid',
	completed: 'Completed',
	cancelled: 'Cancelled',
	expired: 'Expired'
};

const VARIANTS: Record<OrderStatus, OrderBadgeVariant> = {
	pending_payment: 'warning', // needs the buyer to act
	paid: 'success',
	completed: 'brand', // terminal and good — distinct from the transient `paid`
	cancelled: 'neutral',
	expired: 'neutral'
};

export function orderStatusLabel(status: string): string {
	return LABELS[status as OrderStatus] ?? status;
}

export function orderStatusVariant(status: string): OrderBadgeVariant {
	return VARIANTS[status as OrderStatus] ?? 'neutral';
}

/** Terminal statuses offer no actions at all. */
export function isTerminalOrderStatus(status: string): boolean {
	return status === 'completed' || status === 'cancelled' || status === 'expired';
}

/**
 * Money is stored as integer cents (D8); every display divides by exactly 100
 * here rather than each page inventing its own conversion.
 */
export function centsToMajor(cents: number): number {
	return cents / 100;
}

export interface TimelineStep {
	label: string;
	at: string | null;
	/** Reached — render it as done rather than pending. */
	done: boolean;
}

/**
 * created → paid → completed, showing only the timestamps that exist.
 *
 * Cancelled and expired orders never reached `paid`, so their timeline ends at
 * the step that actually happened rather than showing two greyed-out futures
 * that will never occur.
 */
export function orderTimeline(order: {
	status: string;
	created_at: string;
	paid_at: string | null;
	completed_at: string | null;
	cancelled_at: string | null;
	expired_at: string | null;
}): TimelineStep[] {
	const steps: TimelineStep[] = [{ label: 'Order started', at: order.created_at, done: true }];

	if (order.status === 'cancelled') {
		steps.push({ label: 'Cancelled', at: order.cancelled_at, done: true });
		return steps;
	}
	if (order.status === 'expired') {
		steps.push({ label: 'Expired', at: order.expired_at, done: true });
		return steps;
	}

	steps.push({ label: 'Payment received', at: order.paid_at, done: !!order.paid_at });
	steps.push({
		label: 'Receipt confirmed',
		at: order.completed_at,
		done: !!order.completed_at
	});
	return steps;
}
