/**
 * Notification presentation helpers (Notifications PRD — Sections 4 and 6).
 *
 * Pure, and deliberately shared by BOTH renderers: the in-app inbox and the
 * email templates. One notification must not describe itself one way in the bell
 * menu and another way in the inbox and a third way in the email — and the only
 * reliable way to guarantee that is to have one place that turns a (type,
 * payload) pair into words.
 *
 * Nothing here decides anything. Routing lives in $lib/server/notifications;
 * this file only knows how to say what happened.
 */

/**
 * The NTF-2 catalog, matching the type CHECK in the migration exactly.
 *
 * The last four are the ADM phase's (ADM-8, ADM-13). Confirmed against LIVE
 * catalog state rather than migration text: `notifications_type_check` carries
 * all eleven values.
 */
export const NOTIFICATION_TYPES = [
	'order.paid',
	'order.completed',
	'payout.sent',
	'review.received',
	'review.response',
	'boost.activated',
	'boost.expiring_24h',
	'dispute.opened',
	'dispute.under_review',
	'dispute.resolved',
	'listing.removed'
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isNotificationType(value: string): value is NotificationType {
	return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

/**
 * Which side of the transaction the recipient is on.
 *
 * `order.paid` and `order.completed` notify BOTH parties off one event, and the
 * two need different words — "your payment went through" versus "you have a new
 * order". The discriminator lives in the payload rather than in the type so the
 * catalog stays at seven entries (NTF-2) instead of nine.
 */
export type NotificationRole = 'buyer' | 'seller';

/** How a dispute ended, for `dispute.resolved` copy (ADM-3's two outcomes). */
export type DisputeOutcome = 'refunded' | 'rejected';

/**
 * What a handler stores in `payload`. Every field is optional at read time.
 *
 * NOT the same type as `NotificationSourceIds` in $lib/server/notifications,
 * and widening one does not widen the other — they do different jobs. This is
 * what gets stored in the payload jsonb and read by copy/href/icon; that one
 * feeds `dedupeKeyFor` for idempotency and never reaches the renderer.
 */
export interface NotificationPayload {
	role?: NotificationRole;
	orderId?: string;
	listingId?: string;
	listingTitle?: string;
	reviewId?: string;
	boostId?: string;
	payoutId?: string;
	/** KES cents, as stored — formatted at the edges, never in the payload. */
	amount?: number;
	rating?: number;
	expiresAt?: string;
	/** ADM-8. Without this, `notificationHref` cannot link a dispute anywhere. */
	disputeId?: string;
	/**
	 * ADM-13(c) — the admin's takedown reason, and ADM-3's resolution note. Free
	 * text written by an admin, so it is rendered as TEXT, never as markup.
	 */
	note?: string;
	/**
	 * ADM-3's two outcomes. Beyond the ten-item widening list, and deliberately:
	 * `role` alone tells a party WHO they are, not WHAT was decided, and
	 * "your dispute was resolved" without saying how is precisely the silent dead
	 * end ADM-13 exists to prevent.
	 */
	disputeOutcome?: DisputeOutcome;
}

export interface NotificationRow {
	id: string;
	type: string;
	payload: NotificationPayload;
	read_at: string | null;
	created_at: string;
}

/**
 * "KSh 12,500" from an amount in CENTS, matching the Price component's output.
 *
 * The payload stores cents because every money column in this app does
 * (`amount_total`, `amount_kes_cents`); the conversion belongs at the display
 * edge, which is here — the same split `centsToMajor` + `<Price>` makes on every
 * other surface. Stored major units would be a second convention nobody expects.
 */
export function formatKesFromCents(cents: number | null | undefined): string {
	const n = typeof cents === 'number' && Number.isFinite(cents) ? cents / 100 : 0;
	return `KSh ${new Intl.NumberFormat('en-KE', {
		minimumFractionDigits: 0,
		maximumFractionDigits: 2
	}).format(n)}`;
}

/**
 * A listing title we can drop into a sentence.
 *
 * Falls back rather than rendering "undefined" or an empty gap: a notification
 * whose listing was deleted still has to read as English, and NTF-12 makes these
 * rows immutable — we cannot go back and repair the copy later.
 */
function titleOf(payload: NotificationPayload): string {
	const t = payload.listingTitle?.trim();
	return t ? t : 'your listing';
}

function itemOf(payload: NotificationPayload): string {
	const t = payload.listingTitle?.trim();
	return t ? t : 'your item';
}

export interface NotificationCopy {
	/** One line, sentence case, no trailing period — it is a heading. */
	title: string;
	/** One or two sentences. */
	body: string;
	/** The call to action in the email button; the inbox links the whole row. */
	action: string;
}

/**
 * Turn one notification into the words a person reads.
 *
 * Exhaustive over the catalog by construction: the switch returns from every
 * arm, and `NotificationType` is a closed union, so adding an eighth event is a
 * compile error here until its copy is written.
 */
export function notificationCopy(
	type: NotificationType,
	payload: NotificationPayload
): NotificationCopy {
	switch (type) {
		case 'order.paid':
			return payload.role === 'seller'
				? {
						title: 'You have a new order',
						body: `${titleOf(payload)} has been paid for. Arrange delivery with your buyer — you will be paid once they confirm they have received it.`,
						action: 'View the sale'
					}
				: {
						title: 'Payment confirmed',
						body: `We received your ${formatKesFromCents(payload.amount)} payment for ${itemOf(payload)}. The seller has been notified.`,
						action: 'View your order'
					};

		case 'order.completed':
			return payload.role === 'seller'
				? {
						title: 'An order was completed',
						body: `Your buyer confirmed they received ${itemOf(payload)}. Your earnings from this sale are now available to pay out.`,
						action: 'View your payouts'
					}
				: {
						title: 'Order completed',
						body: `You confirmed you received ${itemOf(payload)}. If you have a moment, leaving the seller a review helps other buyers.`,
						action: 'Leave a review'
					};

		case 'payout.sent':
			return {
				title: 'Your payout is on its way',
				body: `${formatKesFromCents(payload.amount)} has been sent to your Mpesa number. It usually arrives within a few minutes.`,
				action: 'View your payouts'
			};

		case 'review.received':
			return {
				title: `You received a ${payload.rating ?? 0}-star review`,
				body: `A buyer reviewed their order for ${titleOf(payload)}. You can reply to it once, publicly.`,
				action: 'Read the review'
			};

		case 'review.response':
			return {
				title: 'The seller replied to your review',
				body: `Your review of ${itemOf(payload)} has a public reply from the seller.`,
				action: 'Read the reply'
			};

		case 'boost.activated':
			return {
				title: 'Your boost is live',
				body: `${titleOf(payload)} is now boosted and will appear above other listings in search and category pages.`,
				action: 'View your listings'
			};

		case 'boost.expiring_24h':
			return {
				title: 'Your boost ends tomorrow',
				body: `The boost on ${titleOf(payload)} expires in about 24 hours. You can extend it at any time — extending adds to the time you have left.`,
				action: 'Extend the boost'
			};

		// ---- ADM-8 disputes -------------------------------------------------
		// Single-party, so no role branch: only the seller is told (ADM-8).
		case 'dispute.opened':
			return {
				title: 'A buyer opened a dispute',
				body: `A buyer has raised a problem with their order for ${titleOf(payload)}. Our team will look into it. Your earnings from this order are on hold until it is settled.`,
				action: 'View the sale'
			};

		// Buyer-facing, and the only one of the four that is not transactional —
		// nothing has moved yet, this is a progress update (ADM-12).
		case 'dispute.under_review':
			return {
				title: 'Your dispute is being reviewed',
				body: `We are looking into the problem you reported with ${itemOf(payload)}. We will let you know as soon as there is a decision.`,
				action: 'View your order'
			};

		// The role discriminator, the order.paid pattern (ADM-12) — the two
		// parties need materially different wording on a refund outcome. Branching
		// on the OUTCOME too, because "resolved" alone tells neither of them what
		// actually happened.
		case 'dispute.resolved': {
			const refunded = payload.disputeOutcome === 'refunded';
			const note = payload.note?.trim();
			const because = note ? ` ${note}` : '';

			if (payload.role === 'seller') {
				return refunded
					? {
							title: 'A dispute was settled with a refund',
							body: `The buyer has been refunded for ${itemOf(payload)}.${because} Your earnings from this order will not be paid out.`,
							action: 'View the sale'
						}
					: {
							title: 'A dispute was closed',
							body: `The dispute on ${titleOf(payload)} was closed without a refund.${because} Your earnings from this order are no longer on hold.`,
							action: 'View the sale'
						};
			}

			return refunded
				? {
						title: 'Your refund is on its way',
						body: `We have refunded your payment for ${itemOf(payload)}.${because} It goes back the same way you paid.`,
						action: 'View your order'
					}
				: {
						title: 'Your dispute was closed',
						body: `We reviewed the problem you reported with ${itemOf(payload)} and did not issue a refund.${because}`,
						action: 'View your order'
					};
		}

		// ---- ADM-13 moderation ----------------------------------------------
		// The whole point of this type: without it the seller sees a listing with
		// every action disabled and no explanation.
		case 'listing.removed': {
			const note = payload.note?.trim();
			return {
				title: 'Your listing was taken down',
				body: `${titleOf(payload)} has been removed by our team and is no longer visible to buyers.${note ? ` ${note}` : ''}`,
				action: 'View your listings'
			};
		}
	}
}

/**
 * Where a notification points.
 *
 * Every type resolves to a page that already exists — no notification is a dead
 * end. Where the entity id is missing (an old row, a deleted source), the link
 * degrades to the section's index rather than to a 404.
 */
export function notificationHref(type: NotificationType, payload: NotificationPayload): string {
	const orderHref = payload.orderId ? `/account/orders/${payload.orderId}` : '/account/orders';

	switch (type) {
		case 'order.paid':
			return payload.role === 'seller' ? '/sell/sales' : orderHref;
		case 'order.completed':
			// The seller's completion is about money, so it goes to payouts; the
			// buyer's carries the review nudge, and the review form lives on the
			// order page (NTF-2).
			return payload.role === 'seller' ? '/sell/payouts' : orderHref;
		case 'payout.sent':
			return '/sell/payouts';
		case 'review.received':
			return '/sell/sales';
		case 'review.response':
			return orderHref;
		case 'boost.activated':
		case 'boost.expiring_24h':
			return '/sell/listings?tab=boosted';

		// The seller has no per-order detail route — /sell/sales is the list and
		// the dispute panel renders on the row, so that is where the seller's
		// dispute links go. The buyer's go to their own order page.
		case 'dispute.opened':
			return '/sell/sales';
		case 'dispute.under_review':
			return orderHref;
		case 'dispute.resolved':
			return payload.role === 'seller' ? '/sell/sales' : orderHref;

		// Not ?tab=removed: a taken-down listing is not in any of the management
		// tabs' filters, and pointing at a tab that will not contain it is the
		// dead end ADM-13 exists to close.
		case 'listing.removed':
			return '/sell/listings';
	}
}

/**
 * The icon glyph for the inbox row, keyed by what the notification is ABOUT
 * rather than by type: money, an order, a review, a boost, an enforcement
 * action. Five shapes across eleven types is deliberate — the list should be
 * scannable by category.
 *
 * `moderation` is the ADM-8 addition. Disputes deliberately do NOT get their own
 * shape: they are order-anchored, so they reuse `order`. A takedown is not — no
 * existing shape fits an enforcement action, and `review` would actively mislead
 * a seller into thinking a buyer had written something.
 */
export type NotificationIcon = 'money' | 'order' | 'review' | 'boost' | 'moderation';

export function notificationIcon(type: NotificationType): NotificationIcon {
	switch (type) {
		case 'order.paid':
		case 'payout.sent':
			return 'money';
		case 'order.completed':
		case 'dispute.opened':
		case 'dispute.under_review':
		case 'dispute.resolved':
			return 'order';
		case 'review.received':
		case 'review.response':
			return 'review';
		case 'boost.activated':
		case 'boost.expiring_24h':
			return 'boost';
		case 'listing.removed':
			return 'moderation';
	}
}
