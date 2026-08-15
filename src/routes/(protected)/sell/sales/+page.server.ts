import { fail, redirect } from '@sveltejs/kit';
import { createSupabaseAdmin } from '$lib/server/supabase-admin';
import { getCoverUrl } from '$lib/listing-images';
import { listReviewsForSeller, submitSellerResponse } from '$lib/server/reviews';
import { emitReviewResponse } from '$lib/server/notification-events';
import { REVIEW_RESPONSE_MAX } from '$lib/reviews';
import type { Actions, PageServerLoad } from './$types';

/**
 * The seller's sales (Checkout PRD — Section 9, route per R-6).
 *
 * Lives under /sell so it inherits that group's role guard — no duplicate check
 * here.
 *
 * This page was read-only "until payouts" (Checkout Section 9). Payouts shipped,
 * so that condition has expired, and the Reviews phase adds the FIRST write here:
 * `sellerRespond` (Reviews PRD Section 6, R-13). It is deliberately the only one.
 * The page remains read-only for every ORDER action — refunds, cancellations,
 * fulfilment — which arrive in their own phases. A response is a write about a
 * REVIEW, not about an order.
 *
 * Unlike the buyer's view this DOES select `commission_amount` and `seller_net`.
 * The seller is entitled to see the split — it is their money — and the payouts
 * phase reads the same `seller_net`.
 */

/** Matches the listing page's cap; no pagination this phase (Section 7.5). */
const REVIEW_CAP = 20;

export const load: PageServerLoad = async ({ locals: { supabase, user } }) => {
	// All three reads are independent — orders, the review list and the seller's
	// own aggregate share nothing but the user id — so they go concurrently.
	// Awaiting them in sequence costs two extra round trips on EVERY load of this
	// page, and the browser Back button re-runs the load, which is where it was
	// noticed: SvelteKit refetches __data.json on a history navigation, so the
	// serial latency landed on exactly the interaction that feels like it should
	// be instant.
	const [ordersRes, reviews, meRes] = await Promise.all([
		supabase
			.from('orders')
			// One string literal, not a concatenation: supabase-js infers the row type
			// from the literal, and `a + b` widens it to `string` (every field then
			// types as GenericStringError).
			.select(
				'id, status, amount_total, commission_amount, seller_net, created_at, paid_at, listing_id, buyer_id, listings(title, type, listing_images(storage_path, position)), profiles!orders_buyer_id_fkey(full_name)'
			)
			.eq('seller_id', user!.id)
			// Sales only — orders that reached `paid` or beyond.
			//
			// A checkout that was cancelled or expired was never a sale, offers the
			// seller nothing to act on (isTerminalOrderStatus already treats both as
			// dead), and contributes nothing to the earnings figure above the list,
			// which counts `completed` only. Left in, they would dominate: abandonment
			// is the common outcome at checkout, and every abandoned attempt leaves a
			// row — `cancelled` when the buyer backs out, `expired` when the Inngest
			// job reaps the 30-minute hold. The real sales would end up scattered among
			// them.
			//
			// `pending_payment` is excluded for the same reason: it is a hold in
			// progress, not a sale, and it resolves within 30 minutes either way.
			// `paid` IS included — the money is real and the seller is simply waiting
			// on the buyer to confirm receipt.
			//
			// Nothing is deleted. The rows remain the audit trail, and abandonment is
			// a question for a future analytics view rather than for this list.
			.in('status', ['paid', 'completed'])
			.order('created_at', { ascending: false }),

		// Reviews buyers left on this seller's listings (Section 6). Fetched
		// independently of `sales` rather than joined onto it: a review outlives the
		// window this list shows, and the reviews section is its own block on the
		// page rather than a column in the sales table.
		listReviewsForSeller(supabase, user!.id, REVIEW_CAP),

		// The seller's own aggregate. Without this the only way for a seller to
		// learn what they are rated is to open one of their public listings and read
		// the seller block — their reputation visible to everyone except themselves.
		// Counts ALL their reviews, which is why it is read here rather than derived
		// from `reviews`: that list is capped at REVIEW_CAP.
		supabase.from('profiles').select('review_count, rating_sum').eq('id', user!.id).single()
	]);

	const rows = ordersRes.data ?? [];
	const me = meRes.data;

	// Recover listings the embed above could not see.
	//
	// A soft-deleted listing (status 'deleted') is hidden by RLS from EVERYONE,
	// its owner included, so the `listings(...)` embed comes back null and the
	// seller loses the title and photo of something they actually sold — in their
	// own earnings record. The buyer's order page already refuses to let that
	// happen (see account/orders/[id]: "an order's record must not stop rendering"
	// because of a later soft-delete); this is the same guarantee for the seller.
	//
	// Runs ONLY when something is missing, so the ordinary page — where every
	// listing is still visible — pays nothing for it. One query regardless of how
	// many rows are affected.
	//
	// Safe to reach past RLS here: the ids come from orders already filtered to
	// `seller_id = user.id`, so this can only ever resolve the caller's OWN
	// listings, and only the two fields the row needs to render.
	const hiddenIds = [...new Set(rows.filter((o) => !o.listings).map((o) => o.listing_id))];
	const recovered = new Map<
		string,
		{ title: string; listing_images: { storage_path: string; position: number }[] }
	>();

	if (hiddenIds.length > 0) {
		const { data: hidden } = await createSupabaseAdmin()
			.from('listings')
			.select('id, title, listing_images(storage_path, position)')
			.in('id', hiddenIds);

		for (const l of hidden ?? []) {
			recovered.set(l.id, { title: l.title, listing_images: l.listing_images ?? [] });
		}
	}

	// Disputes on these sales (ADM-1). Read through the SESSION client:
	// disputes_select admits the seller via `dispute_party(order_id)`, which
	// covers both parties on the order — so a seller sees disputes on their own
	// sales without any service-role read.
	//
	// The seller has no per-order detail route, so this list IS the seller's
	// dispute view. One query for the whole page rather than one per row.
	const { data: disputeRows } =
		rows.length > 0
			? await supabase
					.from('disputes')
					.select('id, order_id, status, reason, resolution_note, created_at, resolved_at')
					.in(
						'order_id',
						rows.map((o) => o.id)
					)
					.order('created_at', { ascending: false })
			: { data: [] };

	// Newest first from the query, and only the first per order is kept — the
	// live one when there is one, otherwise the most recent settled one.
	const disputeByOrder = new Map<string, NonNullable<typeof disputeRows>[number]>();
	for (const d of disputeRows ?? []) {
		if (!disputeByOrder.has(d.order_id)) disputeByOrder.set(d.order_id, d);
	}

	const sales = rows.map((o) => {
		// The embed when RLS allowed it, the service-role recovery when it did not.
		const listing = o.listings ?? recovered.get(o.listing_id) ?? null;
		const dispute = disputeByOrder.get(o.id) ?? null;
		return {
			id: o.id,
			status: o.status,
			dispute: dispute
				? {
						id: dispute.id,
						status: dispute.status,
						reason: dispute.reason,
						resolutionNote: dispute.resolution_note,
						createdAt: dispute.created_at,
						resolvedAt: dispute.resolved_at
					}
				: null,
			amountTotal: o.amount_total,
			commissionAmount: o.commission_amount,
			sellerNet: o.seller_net,
			createdAt: o.created_at,
			paidAt: o.paid_at,
			listingId: o.listing_id,
			// Only a listing that is genuinely gone from the database still reads as
			// unavailable; a merely hidden one now shows what it always was.
			title: listing?.title ?? 'Listing no longer available',
			coverUrl: listing ? getCoverUrl(supabase, listing) : null,
			// profiles are world-readable, so the seller's own client resolves the
			// buyer's display name without any service-role escalation.
			buyerName: o.profiles?.full_name ?? 'Buyer'
		};
	});

	// Earned so far: only completed orders are payout-eligible (D5), so that is
	// the figure worth surfacing rather than a total of everything ever started.
	const completedNet = sales
		.filter((s) => s.status === 'completed')
		.reduce((sum, s) => sum + (s.sellerNet ?? 0), 0);

	return {
		sales,
		completedNet,
		reviews,
		sellerAggregate: {
			reviewCount: me?.review_count ?? 0,
			ratingSum: me?.rating_sum ?? 0
		}
	};
};

export const actions: Actions = {
	// The seller's one public reply per review (D5). Every authorization check
	// lives inside submit_seller_response — `authenticated` holds no UPDATE grant
	// on `reviews`, so this rpc is the only path that exists.
	sellerRespond: async ({ request, locals: { supabase } }) => {
		const form = await request.formData();
		const reviewId = String(form.get('reviewId') ?? '');
		const response = String(form.get('response') ?? '').trim();

		if (!reviewId) return fail(400, { responseError: 'That reply could not be posted.' });
		if (!response) return fail(400, { responseError: 'Write a reply before posting it.' });
		if (response.length > REVIEW_RESPONSE_MAX) {
			return fail(400, { responseError: 'Keep your reply to 1000 characters or fewer.' });
		}

		const result = await submitSellerResponse(supabase, reviewId, response);
		if (!result.ok) return fail(400, { responseError: result.error });

		// Notifications Section 3.2 — the buyer learns their review was answered.
		// After the RPC, so a reply refused by submit_seller_response (not the
		// seller, already answered, review hidden) notifies nobody.
		await emitReviewResponse(reviewId);

		// POST-redirect-get, matching every other write in the app.
		redirect(303, '/sell/sales');
	}
};
