import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '$lib/types/database';
import type { NotificationPayload, NotificationType } from '$lib/notifications';

/**
 * ⚠️ SERVER-ONLY. Notification creation and delivery routing (Notifications PRD
 * — Sections 3 and 4; NTF-3, NTF-7, NTF-17).
 *
 * Extracted from the Inngest handlers so the parts that decide things — which
 * channel an event uses, what its dedupe_key is, whether a toggle applies — are
 * testable without a scheduler, the same way `runWeeklySweep` and `expireBoost`
 * are. The handlers in $lib/server/notification-functions do the I/O; this file
 * holds the rules.
 */

type Admin = SupabaseClient<Database>;
/**
 * A request-scoped client carrying the user's session. Named apart from `Admin`
 * on purpose: the reads below MUST run as the caller so own-row RLS applies,
 * and a service-role client passed here would silently return everyone's rows.
 */
type Caller = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// NTF-3 — the delivery matrix
// ---------------------------------------------------------------------------

/**
 * The money events. These are transactional receipts: a person is told what
 * happened to their money, so the email is ATTEMPTED regardless of the NTF-4
 * toggle (NTF-3 as amended).
 *
 * `order.completed` is deliberately NOT here even though an order is money.
 * Nothing moves at completion that the recipient did not already initiate — the
 * buyer pressed the button, or seven days elapsed — and the seller's money event
 * is `payout.sent`. Treating it as transactional would mean a user who switched
 * activity email OFF still gets mail for something they did themselves.
 */
/*
 * ⚠️ NOTHING CHECKS THIS SET. It is a plain Set with no exhaustiveness
 * constraint, so a new type omitted here does not break the build — it falls
 * through `shouldSendEmail`'s `emailActivity ?? true` and a recipient with
 * activity email switched OFF gets no email at all. Every other widening in this
 * module is compile-enforced; this one is enforced by review only.
 *
 * The ADM additions and why each qualifies (ADM-12, ADM-13e):
 *   dispute.opened      YES — under ADM-11 the seller's available balance drops
 *                       the moment a dispute opens. Money leaves their reachable
 *                       balance through an action they did not initiate, which
 *                       is this set's own stated criterion.
 *   dispute.resolved    YES — in the refunded case money moves and the recipient
 *                       did not initiate it. Same criterion.
 *   listing.removed     YES — not a money event, but an enforcement action the
 *                       seller can discover no other way, which is ADM-13's
 *                       entire premise. Leaving it suppressible would silently
 *                       undo the ruling for exactly the sellers least likely to
 *                       be logged in.
 *   dispute.under_review NO — buyer-facing, nothing moves, ordinary process
 *                       mail. The only one of the four left out (ADM-12).
 */
const TRANSACTIONAL: ReadonlySet<NotificationType> = new Set([
	'order.paid',
	'payout.sent',
	'boost.activated',
	'dispute.opened',
	'dispute.resolved',
	'listing.removed'
]);

export function isTransactional(type: NotificationType): boolean {
	return TRANSACTIONAL.has(type);
}

/**
 * Whether to attempt an email for this notification.
 *
 * `emailActivity` is what `profiles_private.email_activity` says, or NULL when
 * the recipient has NO profiles_private row at all — a valid state (PII D3), and
 * the common one for a user who never saved a phone number. The NTF-4 corollary
 * fixes that reading: absent means TRUE. Coalescing here rather than at the
 * query means no caller can forget it.
 *
 * In-app delivery is not represented in this function because it has no
 * condition: every event in the catalog creates a row for every recipient
 * (NTF-3). The only channel with a switch is email.
 */
export function shouldSendEmail(
	type: NotificationType,
	emailActivity: boolean | null | undefined
): boolean {
	if (isTransactional(type)) return true;
	return emailActivity ?? true;
}

// ---------------------------------------------------------------------------
// NTF-7 / NTF-17 — idempotency
// ---------------------------------------------------------------------------

/** The source entity each type keys its identity on (NTF-17). */
const DEDUPE_SOURCE = {
	'order.paid': 'orderId',
	'order.completed': 'orderId',
	'payout.sent': 'payoutId',
	// The ORDER, not the review: insertReview does not read the row back, and one
	// review per order makes the two identities interchangeable.
	'review.received': 'orderId',
	'review.response': 'reviewId',
	'boost.activated': 'boostId',
	'boost.expiring_24h': 'boostId',
	// ADM-12 — the DISPUTE, not the order: an order can carry more than one
	// dispute over its life (one at a time, per ADM-1's partial unique index), so
	// keying on the order would collapse a second dispute into the first one's
	// notification.
	'dispute.opened': 'disputeId',
	'dispute.under_review': 'disputeId',
	'dispute.resolved': 'disputeId',
	// ADM-13b — the AUDIT ROW, not the listing. `createNotification` inserts with
	// ignoreDuplicates, so a listing id would mean takedown → restore → takedown
	// silently discards the second notification, reproducing the exact dead end
	// ADM-13 exists to prevent. A dispute id is single-lifecycle; a listing id is
	// not. The audit row id is unique per takedown and ties the notification to
	// its admin_actions record.
	'listing.removed': 'adminActionId'
} as const satisfies Record<NotificationType, keyof NotificationSourceIds>;

/**
 * The id each type keys idempotency on — NOT the same type as
 * `NotificationPayload`, and widening one does not widen the other. This never
 * reaches the renderer; it exists only so `dedupeKeyFor` can derive a stable
 * key.
 */
export interface NotificationSourceIds {
	orderId?: string;
	reviewId?: string;
	boostId?: string;
	payoutId?: string;
	disputeId?: string;
	adminActionId?: string;
}

/**
 * The dedupe_key for one notification, derived from the SOURCE ENTITY.
 *
 * Never from the event delivery, the timestamp, or a random value — those would
 * make the unique constraint unable to see that a retry is a retry, which is the
 * whole guarantee (NTF-7). Two events about the same order legitimately produce
 * two rows because `type` is part of the constraint, and two recipients produce
 * two rows because `user_id` is.
 *
 * THROWS on a missing id rather than falling back to something unique-ish. A
 * silently unkeyed notification would duplicate on every retry, and duplicates
 * in an inbox are the one failure mode users notice immediately.
 */
export function dedupeKeyFor(type: NotificationType, ids: NotificationSourceIds): string {
	const field = DEDUPE_SOURCE[type];
	const value = ids[field];
	if (!value) {
		throw new Error(`dedupeKeyFor(${type}): missing ${field} — cannot key idempotency`);
	}
	return value;
}

/**
 * The idempotency key for the EMAIL that accompanies a notification (NTF-8).
 *
 * Mirrors the in-app key exactly, so the two channels collapse retries on the
 * same identity: one Inngest retry cannot produce a second row OR a second
 * email. Resend deduplicates on this key for 24 hours, which comfortably covers
 * a function's retry window.
 */
export function emailIdempotencyKey(
	type: NotificationType,
	userId: string,
	dedupeKey: string
): string {
	return `${type}:${userId}:${dedupeKey}`;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface CreateNotificationInput {
	userId: string;
	type: NotificationType;
	dedupeKey: string;
	payload: NotificationPayload;
}

export interface CreateNotificationResult {
	/** False when the unique constraint absorbed a retry — a normal outcome. */
	created: boolean;
	/** Null when nothing was inserted, for the same reason. */
	id: string | null;
}

/**
 * Insert one notification, conflict-no-op (NTF-7).
 *
 * `ignoreDuplicates` makes this `insert ... on conflict do nothing`, so a second
 * run inserts nothing and returns no row — which is how `created: false` is
 * decided. That is the SQL predicate doing the work rather than a prior SELECT,
 * the amended BST-12 pattern: two concurrent retries cannot both see "no row
 * yet" and both insert.
 *
 * Service-role only. `authenticated` holds no INSERT grant of any width, so this
 * would be a hard 42501 with any other client — deliberately, so a request-path
 * caller cannot exist by accident.
 */
export async function createNotification(
	admin: Admin,
	input: CreateNotificationInput
): Promise<CreateNotificationResult> {
	const { data, error } = await admin
		.from('notifications')
		.upsert(
			{
				user_id: input.userId,
				type: input.type,
				dedupe_key: input.dedupeKey,
				payload: input.payload as Json
			},
			{ onConflict: 'user_id,type,dedupe_key', ignoreDuplicates: true }
		)
		.select('id')
		.maybeSingle();

	// Database trouble is infrastructure — throw so Inngest retries. A conflict is
	// NOT an error and never lands here: DO NOTHING returns cleanly with no row.
	if (error) throw new Error(`createNotification(${input.type}) failed: ${error.message}`);

	return { created: data !== null, id: data?.id ?? null };
}

// ---------------------------------------------------------------------------
// Reads (Section 6) — through the CALLER's client, never the admin one
// ---------------------------------------------------------------------------

/**
 * How many unread notifications the caller has (NTF-10).
 *
 * `head: true` so PostgREST returns the count in a header and no rows at all —
 * the badge needs a number, and shipping the rows to compute it would make the
 * cheapest query on the page one of the more expensive ones. The partial index
 * carries this; there is no counter table (NTF-10).
 *
 * Own-row RLS is the scoping, not a `.eq('user_id', …)` here: the policy is the
 * boundary, and re-stating it in the query would make a policy regression
 * invisible in exactly the surface most likely to notice it.
 */
export async function unreadNotificationCount(caller: Caller): Promise<number> {
	const { count, error } = await caller
		.from('notifications')
		.select('id', { count: 'exact', head: true })
		.is('read_at', null);

	if (error) throw new Error(`unreadNotificationCount failed: ${error.message}`);
	return count ?? 0;
}

/** How many rows the inbox shows before "that's everything". */
export const INBOX_PAGE_SIZE = 50;

/**
 * The caller's notifications, newest first (Section 6.2).
 *
 * Capped rather than paginated: an inbox with a 90-day retention window and a
 * marketplace's event volume does not reach 50 rows for a normal account, and a
 * pager is UI to maintain for a case that does not exist yet. If it starts
 * mattering, the cap is where to add one.
 */
export async function listNotifications(caller: Caller, limit: number = INBOX_PAGE_SIZE) {
	const { data, error } = await caller
		.from('notifications')
		.select('id, type, payload, read_at, created_at')
		.order('created_at', { ascending: false })
		.limit(limit);

	if (error) throw new Error(`listNotifications failed: ${error.message}`);
	return data ?? [];
}

// ---------------------------------------------------------------------------
// NTF-9 — the boost expiry warning's two decisions
//
// Extracted from the Inngest function for the reason `expireBoost` is extracted
// from its own: the branch that matters — a superseded job doing nothing — has
// to be testable without a scheduler and without waiting out a 30-day sleep.
// ---------------------------------------------------------------------------

/** How far ahead of expiry the warning fires (NTF-2, NTF-9). */
export const WARNING_LEAD_MS = 24 * 60 * 60 * 1000;

/**
 * When to wake, or null when the boost is too short to warn about.
 *
 * Null is Section 5's defensive assertion. No current package is shorter than 24
 * hours, so it is unreachable today — but a 12-hour package added later would
 * otherwise produce a wake time in the PAST, which `sleepUntil` treats as "do
 * not sleep", and the seller would be told their boost "ends tomorrow" on the
 * afternoon it ends.
 */
export function boostWarningInstant(expiresAt: string, now: number = Date.now()): Date | null {
	const warnAt = new Date(expiresAt).getTime() - WARNING_LEAD_MS;
	if (!Number.isFinite(warnAt) || warnAt <= now) return null;
	return new Date(warnAt);
}

/** What a woken warning job should do about the row it found. */
export type WarningDecision = 'send' | 'noop_superseded' | 'unknown_boost';

/**
 * THE SUPERSESSION CHECK (NTF-9 as amended) — a status re-read, not a target
 * comparison.
 *
 * Supersession is EAGER: extending a boost creates a new row and moves the
 * incumbent to `expired` inside the same transaction (BST-5, in
 * `transition_boost_status`). So a superseded job's row is already terminal when
 * it wakes, and asking the row's status is asking the database what it already
 * decided — rather than comparing timestamps and hoping both were read at the
 * right moment.
 *
 * This is the SECOND deliberate overruling of PRD-assumed comparison semantics
 * on this mechanism; see the lineage note at boosts.ts:235-243, where the same
 * assumption was overruled for `expire-boost`. The difference here is that
 * expiry can let the transition graph refuse the write and read the refusal as
 * its answer, while at expiry−24h a live boost is still `active` and there is no
 * transition to refuse — so the same fact has to be established by reading.
 */
export function boostWarningDecision(boost: { status: string } | null): WarningDecision {
	if (!boost) return 'unknown_boost';
	return boost.status === 'active' ? 'send' : 'noop_superseded';
}

// ---------------------------------------------------------------------------
// NTF-11 — retention
// ---------------------------------------------------------------------------

/** How long a READ notification is kept. Unread rows are never pruned. */
export const NOTIFICATION_RETENTION_DAYS = 90;

/**
 * Daily at 03:30 UTC — 06:30 EAT, before Kenyan working hours and well away from
 * the Monday 06:00 UTC payout sweep, so the two never contend for the same
 * minute in the dashboard.
 */
export const NOTIFICATION_PRUNE_CRON = '30 3 * * *';

/**
 * Delete read notifications past the retention window (NTF-11).
 *
 * Two predicates, and both matter. `read_at is not null` is the rule itself: an
 * unread notification is an unkept promise, and pruning it would silently
 * decrement the badge it is being counted by. `created_at` is what "older than
 * 90 days" measures — the row's own age, not how long ago someone happened to
 * open it, which would let a notification read on day 89 survive to day 179.
 *
 * `now` is injectable so the test can age rows without waiting a quarter.
 */
export async function pruneReadNotifications(
	admin: Admin,
	now: Date = new Date()
): Promise<number> {
	const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);

	const { data, error } = await admin
		.from('notifications')
		.delete()
		.not('read_at', 'is', null)
		.lt('created_at', cutoff.toISOString())
		.select('id');

	// Infrastructure — throw so the cron retries. A prune that deletes nothing is
	// the normal case and returns 0.
	if (error) throw new Error(`pruneReadNotifications failed: ${error.message}`);

	return data?.length ?? 0;
}

/**
 * True when the admin API is saying "that user does not exist" rather than
 * "I could not answer" (NTF-3, second amendment).
 *
 * The distinction is the whole point: a deleted account is a final answer and
 * must cost no retries, while a dead credential or a network fault must be
 * retried and, failing that, must go red. Supabase reports the first as a 404,
 * and the message is checked as well because the status is not populated on
 * every transport path.
 */
export function isMissingUserError(error: { status?: number; message?: string }): boolean {
	return error.status === 404 || /user not found/i.test(error.message ?? '');
}

/**
 * Who to email, and whether they want it.
 *
 * The address comes from `auth.users` via the admin API (NTF-15): there is no
 * email column in the public schema, and this phase deliberately does not add
 * one — a copy would be a second source of truth that drifts the first time
 * someone changes their address.
 *
 * A DISCRIMINATED RESULT rather than a nullable address, because the three
 * outcomes are genuinely different and the caller routes on them:
 *   - `gone`       the account was deleted between the event and the send.
 *                  Nothing to send and nothing to retry towards; the in-app row
 *                  cascaded away with the user.
 *   - `no_address` the account exists but carries no email.
 *   - `ok`         send, subject to the toggle.
 *
 * This shape replaced a nullable address that threw on ANY lookup error. The old
 * version turned a deleted fixture user into five retries and a FAILED run — the
 * exact behaviour its own comment said it was avoiding, observed in the
 * 2026-08-11 diagnostic run.
 */
export type RecipientLookup =
	| { outcome: 'ok'; email: string; emailActivity: boolean | null }
	| { outcome: 'gone' }
	| { outcome: 'no_address' };

export async function resolveRecipient(admin: Admin, userId: string): Promise<RecipientLookup> {
	const [{ data: userData, error: userError }, { data: prefs }] = await Promise.all([
		admin.auth.admin.getUserById(userId),
		admin.from('profiles_private').select('email_activity').eq('id', userId).maybeSingle()
	]);

	if (userError) {
		// A vanished account is terminal. Anything else is infrastructure (a dead
		// key looks exactly like this) — throw so the step retries rather than
		// silently sending nothing.
		if (isMissingUserError(userError)) return { outcome: 'gone' };
		throw new Error(`resolveRecipient(${userId}) failed: ${userError.message}`);
	}

	const email = userData?.user?.email;
	// A null user with no error means the same thing as a 404.
	if (!userData?.user) return { outcome: 'gone' };
	if (!email) return { outcome: 'no_address' };

	return {
		outcome: 'ok',
		email,
		// Absent row → null → shouldSendEmail reads it as true (NTF-4 corollary).
		emailActivity: prefs?.email_activity ?? null
	};
}
