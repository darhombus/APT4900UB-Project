import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';

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
	sellerResponse: string | null;
	sellerRespondedAt: string | null;
}

/** Columns every review read needs, plus the author's display name. */
const REVIEW_COLUMNS =
	'id, rating, body, created_at, status, seller_response, seller_responded_at, buyer_id, profiles!reviews_buyer_id_fkey(full_name)';

type ReviewWithAuthor = Omit<ReviewRow, 'order_id' | 'listing_id' | 'seller_id'> & {
	profiles: { full_name: string } | null;
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

export type InsertResult = { ok: true } | { ok: false; error: string };

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
