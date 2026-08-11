import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { createSupabaseAdmin } from '$lib/server/supabase-admin';
import { emitReviewReceived } from '$lib/server/notification-events';

/**
 * Server-side review reads and writes (Reviews PRD Sections 4, 5, 7).
 *
 * Every write here goes through the CALLER's client, never the service role:
 * `reviews_insert` and `reviews_delete` are the enforcement (D10), and routing
 * around them with an admin client would move the security boundary into this
 * file where it is much easier to get wrong.
 */

export type ReviewRow = Database['public']['Tables']['reviews']['Row'];

/** A review as every display surface wants it. */
export interface ReviewView {
	id: string;
	rating: number;
	body: string | null;
	createdAt: string;
	status: Database['public']['Enums']['review_status'];
	authorName: string;
	/** Reviewer's avatar, or null — the list falls back to their initials. */
	authorAvatarUrl: string | null;
	sellerResponse: string | null;
	sellerRespondedAt: string | null;
}

/** Columns every review read needs, plus the author's display name. */
const REVIEW_COLUMNS =
	'id, rating, body, created_at, status, seller_response, seller_responded_at, buyer_id, profiles!reviews_buyer_id_fkey(full_name, avatar_url)';

type ReviewWithAuthor = Omit<ReviewRow, 'order_id' | 'listing_id' | 'seller_id'> & {
	profiles: { full_name: string; avatar_url: string | null } | null;
};

function toView(row: ReviewWithAuthor): ReviewView {
	return {
		id: row.id,
		rating: row.rating,
		body: row.body,
		createdAt: row.created_at,
		status: row.status,
		// A profile row is guaranteed by the FK, but the embed can still come back
		// null if RLS hides it; "A buyer" beats rendering an empty byline.
		authorName: row.profiles?.full_name ?? 'A buyer',
		authorAvatarUrl: row.profiles?.avatar_url ?? null,
		sellerResponse: row.seller_response,
		sellerRespondedAt: row.seller_responded_at
	};
}

/**
 * The review attached to one order, if the caller can see it.
 *
 * Used by the buyer's order page, where `reviews_select`'s author carve-out
 * means a HIDDEN review still comes back — deliberately. The buyer needs to be
 * told their review was hidden rather than being offered a form that would then
 * fail on the unique constraint (Section 7.3).
 */
export async function findReviewForOrder(
	supabase: SupabaseClient<Database>,
	orderId: string
): Promise<ReviewView | null> {
	const { data } = await supabase
		.from('reviews')
		.select(REVIEW_COLUMNS)
		.eq('order_id', orderId)
		.maybeSingle();

	return data ? toView(data as ReviewWithAuthor) : null;
}

/**
 * Visible reviews for a listing, newest first.
 *
 * Filters `status = 'visible'` EXPLICITLY even though RLS already narrows the
 * table. The author carve-out in `reviews_select` would otherwise leak one
 * viewer's own hidden review into a public list whose aggregate count excludes
 * it — the page would contradict itself for exactly one person (Section 7.3).
 */
export async function listReviewsForListing(
	supabase: SupabaseClient<Database>,
	listingId: string,
	limit: number
): Promise<ReviewView[]> {
	const { data } = await supabase
		.from('reviews')
		.select(REVIEW_COLUMNS)
		.eq('listing_id', listingId)
		.eq('status', 'visible')
		.order('created_at', { ascending: false })
		.limit(limit);

	return (data ?? []).map((r) => toView(r as ReviewWithAuthor));
}

/** A review on one of the seller's own sales, with the listing it belongs to. */
export interface SellerReviewView extends ReviewView {
	listingId: string;
	listingTitle: string;
	/**
	 * Where to link the listing, or null when THIS VIEWER has no page to reach.
	 *
	 * A soft-deleted listing is hidden by RLS from everyone including its owner,
	 * so its page 404s for the seller too — linking it would be a dead end. The
	 * title still shows (recovered below); only the link goes. A public viewer
	 * loses the link for drafts, paused and removed listings as well, which 404
	 * for them too — so the rule is the same one, evaluated per viewer.
	 */
	listingHref: string | null;
}

/**
 * Shared body of the two seller-review reads below.
 *
 * Private on purpose. `visibleOnly` decides whether hidden reviews can reach the
 * caller, which is the kind of flag that must never be passed by a caller who has
 * not thought about it — so it is not part of the exported surface. The two
 * wrappers are named for their AUDIENCE instead, and each carries the RLS
 * reasoning that makes its answer the right one (seller profile phase, SP-1).
 */
async function sellerReviews(
	supabase: SupabaseClient<Database>,
	sellerId: string,
	limit: number,
	visibleOnly: boolean
): Promise<SellerReviewView[]> {
	let query = supabase
		.from('reviews')
		.select(`${REVIEW_COLUMNS}, listing_id, listings(title)`)
		.eq('seller_id', sellerId);

	if (visibleOnly) query = query.eq('status', 'visible');

	const { data } = await query.order('created_at', { ascending: false }).limit(limit);

	const rows = (data ?? []) as (ReviewWithAuthor & {
		listing_id: string;
		listings: { title: string } | null;
	})[];

	// Same recovery the sales table does: a listing the VIEWER cannot see through
	// RLS nulls the embed above, and the review loses the title of the thing it is
	// about. Only runs when something is missing, and one query however many rows
	// are affected.
	//
	// Safe past RLS because the ids come from reviews already scoped to this
	// seller, and only the title is read.
	//
	// The principle (SP-1): a previously-public title stays attached to its
	// public visible review. A listing can only carry a review by way of a
	// COMPLETED ORDER, which means it was active and publicly readable for the
	// whole of its selling life — the title is not being disclosed, it is being
	// kept next to the review it explains. That applies uniformly to all four
	// statuses RLS can hide here (`draft`, `paused`, `removed`, `deleted`),
	// whichever of them a given viewer runs into, so none is treated specially.
	const hiddenIds = [...new Set(rows.filter((r) => !r.listings).map((r) => r.listing_id))];
	const recovered = new Map<string, string>();

	if (hiddenIds.length > 0) {
		const { data: hidden } = await createSupabaseAdmin()
			.from('listings')
			.select('id, title')
			.in('id', hiddenIds);
		for (const l of hidden ?? []) recovered.set(l.id, l.title);
	}

	return rows.map((r) => ({
		...toView(r),
		listingId: r.listing_id,
		// The embed seeing it and the listing page being reachable BY THIS VIEWER are
		// the same condition — RLS answers both — so the embed IS the link test, and
		// it stays correct when the viewer changes from the seller to the public.
		listingTitle: r.listings?.title ?? recovered.get(r.listing_id) ?? 'Listing no longer available',
		listingHref: r.listings ? `/listings/${r.listing_id}` : null
	}));
}

/**
 * Reviews written on the seller's listings, for the SELLER's own sales page
 * (Section 6).
 *
 * No `status` filter is needed here and none is wanted: `reviews_select` already
 * limits a seller to VISIBLE rows — the author carve-out is for authors, and a
 * seller is not the author of a review about them. A hidden review is therefore
 * invisible to the seller, which is the correct behaviour: `submit_seller_response`
 * refuses to answer a hidden review anyway, so showing one would only offer a
 * form that cannot succeed.
 */
export async function listReviewsForSeller(
	supabase: SupabaseClient<Database>,
	sellerId: string,
	limit: number
): Promise<SellerReviewView[]> {
	return sellerReviews(supabase, sellerId, limit, false);
}

/**
 * The same reviews for the PUBLIC seller profile page, filtered to visible only.
 *
 * The filter is explicit and load-bearing, and the reasoning above does not carry
 * over: on a public page the author carve-out in `reviews_select` means a viewer
 * reading a seller they themselves reviewed would see their OWN hidden review in
 * a list whose aggregate count (from `profiles.review_count`) excludes it. The
 * page would then contradict itself for exactly one person — the same
 * self-contradiction the listing-page list avoids the same way (REV Section 7.3).
 */
export async function listVisibleReviewsForSeller(
	supabase: SupabaseClient<Database>,
	sellerId: string,
	limit: number
): Promise<SellerReviewView[]> {
	return sellerReviews(supabase, sellerId, limit, true);
}

export type InsertResult = { ok: true } | { ok: false; error: string };

/**
 * Post the seller's one-shot public reply (D5).
 *
 * Every authorization condition lives inside `submit_seller_response`: the
 * caller must be the review's seller, no response may exist yet, and the review
 * must be visible. `authenticated` holds no UPDATE grant on `reviews` at all, so
 * this rpc is the only way a response can ever be written — there is no
 * alternative path to keep in sync.
 *
 * The function signals refusal by RAISING, so every failure arrives here as an
 * error rather than as an empty result. They are mapped to specific messages
 * because they mean genuinely different things to the seller.
 */
export async function submitSellerResponse(
	supabase: SupabaseClient<Database>,
	reviewId: string,
	response: string
): Promise<InsertResult> {
	const { error } = await supabase.rpc('submit_seller_response', {
		review_id: reviewId,
		response
	});

	if (!error) return { ok: true };

	const message = error.message ?? '';
	if (message.includes('response_empty')) {
		return { ok: false, error: 'Write a reply before posting it.' };
	}
	if (message.includes('response_too_long')) {
		return { ok: false, error: 'Keep your reply to 1000 characters or fewer.' };
	}
	if (message.includes('response_not_permitted')) {
		// One message for three refusals — not your review, already answered, or
		// hidden. Distinguishing them would tell a caller who is not the seller
		// whether the review exists, and the honest cases (a second tab, a double
		// submit) are all served by "already has a reply".
		return {
			ok: false,
			error: 'That review can no longer be replied to. It may already have a reply.'
		};
	}
	if (message.includes('not_authenticated')) {
		return { ok: false, error: 'Log in again to reply.' };
	}
	return { ok: false, error: 'That reply could not be posted.' };
}

/**
 * Insert a review for an order the caller bought.
 *
 * The denormalized ids are read from the ORDER server-side and never taken from
 * the form (Section 4.2). The BEFORE INSERT trigger would reject a mismatch
 * anyway, but not sending client-supplied ids at all means there is nothing to
 * reject.
 */
export async function insertReview(
	supabase: SupabaseClient<Database>,
	orderId: string,
	rating: number,
	body: string | null
): Promise<InsertResult> {
	const { data: order } = await supabase
		.from('orders')
		.select('id, listing_id, buyer_id, seller_id, status')
		.eq('id', orderId)
		.maybeSingle();

	// RLS on `orders` already scopes this to orders the caller is party to, so a
	// miss here is a bad id or someone else's order — same message either way.
	if (!order) return { ok: false, error: 'That order could not be found.' };
	if (order.status !== 'completed') {
		return { ok: false, error: 'You can review an order once it is completed.' };
	}

	const { error } = await supabase.from('reviews').insert({
		order_id: order.id,
		listing_id: order.listing_id,
		seller_id: order.seller_id,
		buyer_id: order.buyer_id,
		rating,
		body
	});

	if (error) {
		// 23505 is the one-review-per-order unique constraint. It is reachable
		// honestly — a double submit, or a second tab — so it gets its own message
		// rather than the generic one.
		if (error.code === '23505') {
			return { ok: false, error: 'You have already reviewed this order.' };
		}
		// 42501 / RLS rejection: not the buyer, or the order is not completed.
		// Surfaced as a friendly failure, never a 500 (Section 4.1).
		return { ok: false, error: 'That review could not be saved.' };
	}

	// Notifications Section 3.2. Carries the ORDER id and nothing else: the
	// insert above deliberately does not read the row back — NTF-17 fixes the
	// dedupe_key at the order id precisely so this contract need not change — and
	// the handler looks the review up itself.
	//
	// Emitted only after a successful insert, so the 23505 double-submit path
	// above notifies nobody a second time.
	await emitReviewReceived(order.id);

	return { ok: true };
}

/**
 * Delete the caller's own review (D4), freeing the order slot.
 *
 * Scoped to `buyer_id` here as well as in RLS — belt-and-braces per Section 5.1.
 * A non-author's delete matches zero rows rather than erroring, which is the
 * correct outcome: they learn nothing about whether the review exists.
 */
export async function deleteReview(
	supabase: SupabaseClient<Database>,
	reviewId: string,
	userId: string
): Promise<InsertResult> {
	const { error } = await supabase
		.from('reviews')
		.delete()
		.eq('id', reviewId)
		.eq('buyer_id', userId);

	if (error) return { ok: false, error: 'That review could not be removed.' };
	return { ok: true };
}
