import type { GetStepTools } from 'inngest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdmin } from '$lib/server/supabase-admin';
import { env } from '$lib/server/env';
import { sendEmail } from '$lib/server/email';
import { renderNotificationEmail } from '$lib/server/email-templates';
import {
	NOTIFICATION_PRUNE_CRON,
	boostWarningDecision,
	boostWarningInstant,
	createNotification,
	dedupeKeyFor,
	emailIdempotencyKey,
	isTransactional,
	pruneReadNotifications,
	resolveRecipient,
	shouldSendEmail,
	type NotificationSourceIds
} from '$lib/server/notifications';
import type { NotificationPayload, NotificationType } from '$lib/notifications';
import {
	boostActivated,
	inngest,
	orderCompleted,
	orderPaid,
	payoutSent,
	reviewReceived,
	reviewResponse
} from '$lib/server/inngest';
import type { Database } from '$lib/types/database';

/**
 * Notification handlers (Notifications PRD — Sections 3 and 5).
 *
 * Kept out of $lib/server/inngest-functions for the reason that file gives for
 * existing apart from the client: these are a different concern, they are the
 * only functions in the app whose output is words rather than state, and every
 * one of them is a LEAF — nothing downstream depends on a notification being
 * created, which is what lets every failure here degrade rather than cascade.
 *
 * THE SHAPE EVERY HANDLER SHARES (NTF-3 as amended):
 *   1. load the source entity (throw → retry; missing → loud but terminal)
 *   2. ONE step creating the in-app row(s), conflict-no-op (NTF-7)
 *   3. one step PER EMAIL, each caught: a terminal email failure is logged and
 *      the function still completes successfully
 * The order is load-bearing. The in-app row is the durable half of the promise
 * and must never be rolled back by an email that could not be delivered.
 *
 * RETRIES ARE THE INNGEST DEFAULT here, unlike the checkout/payout functions
 * which pin `retries: 3`. NTF-3 asks for default retries on the email step, and
 * retries are a function-level setting — so the default is what the whole
 * function gets, and the creation step benefits from the extra attempt too.
 */

type Admin = SupabaseClient<Database>;
type StepTools = GetStepTools<typeof inngest>;

/** One person to be told one thing. */
interface Recipient {
	userId: string;
	/** Stable within a run — it becomes the Inngest step id. */
	label: 'buyer' | 'seller';
	payload: NotificationPayload;
}

/** Why an email did not go out. None of these is a failure. */
type EmailOutcome = 'sent' | 'skipped_toggle' | 'skipped_no_address';

// ---------------------------------------------------------------------------
// Source loaders
//
// Every one returns null for "the row is gone" rather than throwing. That is the
// `expireBoost` / `payoutInitiateTransfer` precedent: retrying cannot bring a
// deleted row back, so throwing would burn the retry budget and leave a red run
// in the dashboard for something whose answer is already final. Database trouble
// still throws — that IS retryable.
// ---------------------------------------------------------------------------

interface OrderContext {
	orderId: string;
	buyerId: string;
	sellerId: string;
	listingId: string;
	listingTitle: string | null;
	amount: number;
}

/** PostgREST embeds a to-one relation as an object; typed loosely and narrowed. */
function embeddedTitle(listing: unknown): string | null {
	if (!listing || typeof listing !== 'object') return null;
	const title = (listing as { title?: unknown }).title;
	return typeof title === 'string' ? title : null;
}

async function loadOrder(admin: Admin, orderId: string): Promise<OrderContext | null> {
	const { data, error } = await admin
		.from('orders')
		.select('id, buyer_id, seller_id, listing_id, amount_total, listings(title)')
		.eq('id', orderId)
		.maybeSingle();

	if (error) throw new Error(`notifications: order lookup failed: ${error.message}`);
	if (!data) return null;

	return {
		orderId: data.id,
		buyerId: data.buyer_id,
		sellerId: data.seller_id,
		listingId: data.listing_id,
		listingTitle: embeddedTitle(data.listings),
		amount: Number(data.amount_total)
	};
}

interface ReviewContext {
	reviewId: string;
	orderId: string;
	buyerId: string;
	sellerId: string;
	listingId: string;
	listingTitle: string | null;
	rating: number;
	status: string;
}

async function loadReview(
	admin: Admin,
	by: { orderId: string } | { reviewId: string }
): Promise<ReviewContext | null> {
	const query = admin
		.from('reviews')
		.select('id, order_id, buyer_id, seller_id, listing_id, rating, status, listings(title)');

	const { data, error } = await (
		'orderId' in by ? query.eq('order_id', by.orderId) : query.eq('id', by.reviewId)
	).maybeSingle();

	if (error) throw new Error(`notifications: review lookup failed: ${error.message}`);
	if (!data) return null;

	return {
		reviewId: data.id,
		orderId: data.order_id,
		buyerId: data.buyer_id,
		sellerId: data.seller_id,
		listingId: data.listing_id,
		listingTitle: embeddedTitle(data.listings),
		rating: data.rating,
		status: data.status
	};
}

interface BoostContext {
	boostId: string;
	sellerId: string;
	listingId: string;
	listingTitle: string | null;
	status: string;
	expiresAt: string | null;
}

async function loadBoost(admin: Admin, boostId: string): Promise<BoostContext | null> {
	const { data, error } = await admin
		.from('boosts')
		.select('id, seller_id, listing_id, status, expires_at, listings(title)')
		.eq('id', boostId)
		.maybeSingle();

	if (error) throw new Error(`notifications: boost lookup failed: ${error.message}`);
	if (!data) return null;

	return {
		boostId: data.id,
		sellerId: data.seller_id,
		listingId: data.listing_id,
		listingTitle: embeddedTitle(data.listings),
		status: data.status,
		expiresAt: data.expires_at
	};
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/**
 * Create every recipient's in-app row for one event, in one step.
 *
 * One step rather than one per recipient: a retry re-runs both inserts, and the
 * second is a conflict-no-op, so splitting them would buy nothing but step
 * count. The unique constraint — not this loop — is what makes that safe.
 */
async function createRows(
	admin: Admin,
	type: NotificationType,
	ids: NotificationSourceIds,
	recipients: Recipient[]
): Promise<Record<string, boolean>> {
	const dedupeKey = dedupeKeyFor(type, ids);
	const created: Record<string, boolean> = {};

	for (const recipient of recipients) {
		const result = await createNotification(admin, {
			userId: recipient.userId,
			type,
			dedupeKey,
			payload: recipient.payload
		});
		created[recipient.label] = result.created;
	}

	return created;
}

/**
 * Resolve, gate, render and send one recipient's email.
 *
 * The toggle is read HERE, at send time, not when the event was emitted — a user
 * who switches activity email off while a boost is sleeping out its 30 days must
 * not receive the warning that job wakes up to send.
 */
async function deliverEmail(
	admin: Admin,
	type: NotificationType,
	ids: NotificationSourceIds,
	recipient: Recipient
): Promise<EmailOutcome> {
	const { email, emailActivity } = await resolveRecipient(admin, recipient.userId);

	// The account was deleted between the event and this step. Nothing to send and
	// nothing to retry towards; the in-app row cascaded away with it.
	if (!email) return 'skipped_no_address';

	if (!shouldSendEmail(type, emailActivity)) return 'skipped_toggle';

	const dedupeKey = dedupeKeyFor(type, ids);
	const rendered = renderNotificationEmail({
		type,
		payload: recipient.payload,
		appUrl: env.PUBLIC_APP_URL,
		// The footer tells a recipient whether this email is one they can turn off.
		optional: !isTransactional(type)
	});

	await sendEmail({
		to: email,
		subject: rendered.subject,
		html: rendered.html,
		text: rendered.text,
		idempotencyKey: emailIdempotencyKey(type, recipient.userId, dedupeKey)
	});

	return 'sent';
}

/**
 * Run one email step per recipient, each independently survivable.
 *
 * `.catch()` on the step is the whole of NTF-3's "terminal failure is logged and
 * the function completes successfully". Inngest retries the step first; this
 * catches only what is left after the retries are exhausted, so a transient
 * Resend outage still gets its attempts, and a permanently undeliverable address
 * — the test-domain restriction, today, for every recipient but the operator —
 * does not turn every notification run red.
 *
 * One recipient's failure does not touch the other's: the loop continues.
 */
async function emailRecipients(
	step: StepTools,
	type: NotificationType,
	ids: NotificationSourceIds,
	recipients: Recipient[]
): Promise<Record<string, EmailOutcome | 'failed'>> {
	const outcomes: Record<string, EmailOutcome | 'failed'> = {};

	for (const recipient of recipients) {
		outcomes[recipient.label] = await step
			.run(`email-${recipient.label}`, async () =>
				deliverEmail(createSupabaseAdmin(), type, ids, recipient)
			)
			.catch((err: unknown) => {
				console.error(
					'[notifications] email for %s (%s) failed terminally: %s',
					type,
					recipient.label,
					err instanceof Error ? err.message : String(err)
				);
				return 'failed' as const;
			});
	}

	return outcomes;
}

// ---------------------------------------------------------------------------
// Handlers — NTF-2's catalog, one function per event
// ---------------------------------------------------------------------------

/**
 * `checkout/order.paid` → buyer (payment confirmation) and seller (new order).
 *
 * Inngest-side idempotency mirrors `auto-complete-order`'s: the webhook and the
 * callback page can both finalise the same reference, so one run per order is
 * the optimisation. It is NEVER the guarantee — that is the unique constraint,
 * which holds for a replay outside Inngest's dedup window too.
 */
export const notifyOrderPaid = inngest.createFunction(
	{ id: 'notify-order-paid', idempotency: 'event.data.orderId', triggers: [orderPaid] },
	async ({ event, step }) => {
		const { orderId } = event.data;
		const admin = createSupabaseAdmin();

		const order = await step.run('load-order', async () => loadOrder(admin, orderId));
		if (!order) {
			console.error('[notifications] order.paid for unknown order %s', orderId);
			return { orderId, outcome: 'unknown_order' };
		}

		const shared = {
			orderId: order.orderId,
			listingId: order.listingId,
			listingTitle: order.listingTitle ?? undefined,
			amount: order.amount
		};
		const recipients: Recipient[] = [
			{ userId: order.buyerId, label: 'buyer', payload: { ...shared, role: 'buyer' } },
			{ userId: order.sellerId, label: 'seller', payload: { ...shared, role: 'seller' } }
		];
		const ids = { orderId: order.orderId };

		const created = await step.run('create-notifications', async () =>
			createRows(admin, 'order.paid', ids, recipients)
		);
		const emails = await emailRecipients(step, 'order.paid', ids, recipients);

		return { orderId, created, emails };
	}
);

/**
 * `checkout/order.completed` → buyer (completion + review nudge) and seller.
 *
 * NO Inngest idempotency key, deliberately, and this is the one place the
 * difference matters. The event has TWO emission points that fire under
 * different circumstances — the buyer's confirmation and the 7-day backstop —
 * and only one of them ever happens for a given order. Keying the function on
 * the order id would be harmless but would also hide, in the dashboard, which
 * path actually completed it. The unique constraint already makes a double
 * emission a single row, so the key would buy nothing but lost visibility.
 */
export const notifyOrderCompleted = inngest.createFunction(
	{ id: 'notify-order-completed', triggers: [orderCompleted] },
	async ({ event, step }) => {
		const { orderId } = event.data;
		const admin = createSupabaseAdmin();

		const order = await step.run('load-order', async () => loadOrder(admin, orderId));
		if (!order) {
			console.error('[notifications] order.completed for unknown order %s', orderId);
			return { orderId, outcome: 'unknown_order' };
		}

		const shared = {
			orderId: order.orderId,
			listingId: order.listingId,
			listingTitle: order.listingTitle ?? undefined,
			amount: order.amount
		};
		const recipients: Recipient[] = [
			{ userId: order.buyerId, label: 'buyer', payload: { ...shared, role: 'buyer' } },
			{ userId: order.sellerId, label: 'seller', payload: { ...shared, role: 'seller' } }
		];
		const ids = { orderId: order.orderId };

		const created = await step.run('create-notifications', async () =>
			createRows(admin, 'order.completed', ids, recipients)
		);
		const emails = await emailRecipients(step, 'order.completed', ids, recipients);

		return { orderId, created, emails };
	}
);

/** `payout/sent` → seller. Money moved, so the email is transactional (NTF-3). */
export const notifyPayoutSent = inngest.createFunction(
	{ id: 'notify-payout-sent', idempotency: 'event.data.payoutId', triggers: [payoutSent] },
	async ({ event, step }) => {
		const { payoutId } = event.data;
		const admin = createSupabaseAdmin();

		const payout = await step.run('load-payout', async () => {
			const { data, error } = await admin
				.from('payouts')
				.select('id, seller_id, amount_kes_cents, fee_kes_cents, transfer_amount_kes_cents')
				.eq('id', payoutId)
				.maybeSingle();
			if (error) throw new Error(`notifications: payout lookup failed: ${error.message}`);
			return data;
		});

		if (!payout) {
			console.error('[notifications] payout.sent for unknown payout %s', payoutId);
			return { payoutId, outcome: 'unknown_payout' };
		}

		const recipients: Recipient[] = [
			{
				userId: payout.seller_id,
				label: 'seller',
				payload: {
					payoutId: payout.id,
					// What actually lands in the seller's Mpesa — the transfer amount, net
					// of the fee, not the gross. Generated column; both operands are NOT
					// NULL, so the fallback is arithmetic rather than a guess.
					amount: Number(
						payout.transfer_amount_kes_cents ?? payout.amount_kes_cents - payout.fee_kes_cents
					)
				}
			}
		];
		const ids = { payoutId: payout.id };

		const created = await step.run('create-notifications', async () =>
			createRows(admin, 'payout.sent', ids, recipients)
		);
		const emails = await emailRecipients(step, 'payout.sent', ids, recipients);

		return { payoutId, created, emails };
	}
);

/**
 * `review/received` → seller.
 *
 * The event carries the ORDER id (see the event's own comment), so the review is
 * looked up by it. A hidden review notifies nobody: a moderated review is not
 * something to tell a seller about, and NTF-12 would freeze the wording anyway.
 */
export const notifyReviewReceived = inngest.createFunction(
	{ id: 'notify-review-received', idempotency: 'event.data.orderId', triggers: [reviewReceived] },
	async ({ event, step }) => {
		const { orderId } = event.data;
		const admin = createSupabaseAdmin();

		const review = await step.run('load-review', async () => loadReview(admin, { orderId }));
		if (!review) {
			console.error('[notifications] review.received for order %s with no review', orderId);
			return { orderId, outcome: 'unknown_review' };
		}
		if (review.status !== 'visible') {
			return { orderId, outcome: 'noop_not_visible' };
		}

		const recipients: Recipient[] = [
			{
				userId: review.sellerId,
				label: 'seller',
				payload: {
					reviewId: review.reviewId,
					orderId: review.orderId,
					listingId: review.listingId,
					listingTitle: review.listingTitle ?? undefined,
					rating: review.rating
				}
			}
		];
		const ids = { orderId: review.orderId };

		const created = await step.run('create-notifications', async () =>
			createRows(admin, 'review.received', ids, recipients)
		);
		const emails = await emailRecipients(step, 'review.received', ids, recipients);

		return { orderId, created, emails };
	}
);

/** `review/response` → buyer. */
export const notifyReviewResponse = inngest.createFunction(
	{ id: 'notify-review-response', idempotency: 'event.data.reviewId', triggers: [reviewResponse] },
	async ({ event, step }) => {
		const { reviewId } = event.data;
		const admin = createSupabaseAdmin();

		const review = await step.run('load-review', async () => loadReview(admin, { reviewId }));
		if (!review) {
			console.error('[notifications] review.response for unknown review %s', reviewId);
			return { reviewId, outcome: 'unknown_review' };
		}

		const recipients: Recipient[] = [
			{
				userId: review.buyerId,
				label: 'buyer',
				payload: {
					reviewId: review.reviewId,
					// Carried so the notification can link to the order page, where the
					// buyer's own review (and now its reply) is rendered.
					orderId: review.orderId,
					listingId: review.listingId,
					listingTitle: review.listingTitle ?? undefined
				}
			}
		];
		const ids = { reviewId: review.reviewId };

		const created = await step.run('create-notifications', async () =>
			createRows(admin, 'review.response', ids, recipients)
		);
		const emails = await emailRecipients(step, 'review.response', ids, recipients);

		return { reviewId, created, emails };
	}
);

/** `boost/activated` → seller. Money moved, so the email is transactional. */
export const notifyBoostActivated = inngest.createFunction(
	{ id: 'notify-boost-activated', idempotency: 'event.data.boostId', triggers: [boostActivated] },
	async ({ event, step }) => {
		const { boostId } = event.data;
		const admin = createSupabaseAdmin();

		const boost = await step.run('load-boost', async () => loadBoost(admin, boostId));
		if (!boost) {
			console.error('[notifications] boost.activated for unknown boost %s', boostId);
			return { boostId, outcome: 'unknown_boost' };
		}

		const recipients: Recipient[] = [
			{
				userId: boost.sellerId,
				label: 'seller',
				payload: {
					boostId: boost.boostId,
					listingId: boost.listingId,
					listingTitle: boost.listingTitle ?? undefined,
					expiresAt: boost.expiresAt ?? undefined
				}
			}
		];
		const ids = { boostId: boost.boostId };

		const created = await step.run('create-notifications', async () =>
			createRows(admin, 'boost.activated', ids, recipients)
		);
		const emails = await emailRecipients(step, 'boost.activated', ids, recipients);

		return { boostId, created, emails };
	}
);

/**
 * `boost.expiring_24h` → seller, 24 hours before the window closes (Section 5;
 * NTF-9 as amended).
 *
 * SUPERSESSION IS A STATUS RE-READ, NOT A TARGET COMPARISON. This is the SECOND
 * deliberate overruling of PRD-assumed comparison semantics on this mechanism —
 * see the lineage note at boosts.ts:235-243, where Section 4.2's "the job
 * re-reads the listing's effective expiry and decides whether it has been
 * superseded" was overruled for `expire-boost` on the same grounds.
 *
 * The grounds: supersession is EAGER. Extending creates a new boost and moves
 * the incumbent to `expired` inside the same transaction (BST-5, in
 * `transition_boost_status`), so a superseded job's row is already terminal when
 * it wakes. Expiry could therefore let the transition graph refuse it and read
 * that refusal as the answer. THIS function cannot borrow that trick: at
 * expiry−24h a live boost is still `active`, so there is no transition to be
 * refused and nothing to interpret. Re-reading the row's status is the faithful
 * mirror — same eager-supersession fact, same "the database already knows",
 * expressed as the read this job can actually make.
 *
 * `sleepUntil` a fixed instant for the reason expire-boost does: `expires_at` is
 * immutable for the row's life, so the target cannot drift and a deploy mid-sleep
 * resumes against the same moment.
 */
export const notifyBoostExpiring = inngest.createFunction(
	{
		id: 'notify-boost-expiring',
		// Per PURCHASE, never per listing — the BST-9 grain. Keyed on the listing,
		// an extension bought inside the dedup window would collapse into the
		// earlier run and NO job would own the new window's warning.
		idempotency: 'event.data.boostId',
		triggers: [boostActivated]
	},
	async ({ event, step }) => {
		const { boostId, expiresAt } = event.data;

		// Section 5's defensive assertion, decided in $lib/server/notifications so
		// it is testable without waiting out a sleep. Null means the window is
		// already inside 24 hours and there is no warning to give.
		const warnAt = boostWarningInstant(expiresAt);

		if (!warnAt) {
			console.warn(
				'[notifications] boost %s expires at %s, less than 24h away — no warning sent',
				boostId,
				expiresAt
			);
			return { boostId, outcome: 'noop_too_short' };
		}

		await step.sleepUntil('boost-warning-window', warnAt);

		const admin = createSupabaseAdmin();
		const boost = await step.run('load-boost', async () => loadBoost(admin, boostId));

		const decision = boostWarningDecision(boost);

		// Loud but terminal, exactly as expireBoost treats the same case: an
		// operator clearing test data, or the e2e teardown, deleted the row while
		// this job slept. Reachable in production since 2026-08-11.
		if (decision === 'unknown_boost') {
			console.error(
				'[notifications] boost warning woke for boost %s, which no longer exists',
				boostId
			);
			return { boostId, outcome: 'unknown_boost' };
		}

		// A boost that was extended is already terminal here — the replacement's
		// job owns the new window's warning.
		if (decision === 'noop_superseded') {
			return { boostId, outcome: 'noop_superseded', status: boost!.status };
		}

		if (!boost) return { boostId, outcome: 'unknown_boost' };

		const recipients: Recipient[] = [
			{
				userId: boost.sellerId,
				label: 'seller',
				payload: {
					boostId: boost.boostId,
					listingId: boost.listingId,
					listingTitle: boost.listingTitle ?? undefined,
					expiresAt: boost.expiresAt ?? undefined
				}
			}
		];
		const ids = { boostId: boost.boostId };

		const created = await step.run('create-notifications', async () =>
			createRows(admin, 'boost.expiring_24h', ids, recipients)
		);
		const emails = await emailRecipients(step, 'boost.expiring_24h', ids, recipients);

		return { boostId, created, emails };
	}
);

/**
 * Retention (NTF-11).
 *
 * Prunes READ notifications older than the retention window. Unread rows are
 * never pruned at any age — an unread notification is an unkept promise, and
 * deleting it would silently drop the thing the badge is counting.
 *
 * The second cron function in the codebase, after the weekly payout sweep, and
 * scheduled well away from it: nothing here needs to coincide with a Monday, and
 * an off-hours daily run keeps the two apart in the dashboard.
 */
export const pruneNotifications = inngest.createFunction(
	{ id: 'prune-notifications', triggers: [{ cron: NOTIFICATION_PRUNE_CRON }] },
	async ({ step }) => {
		const deleted = await step.run('prune', async () =>
			pruneReadNotifications(createSupabaseAdmin())
		);

		console.info('[notifications] retention: %d read notifications pruned', deleted);
		return { deleted };
	}
);
