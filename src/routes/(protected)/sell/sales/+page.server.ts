import { fail, redirect } from '@sveltejs/kit';
import { getCoverUrl } from '$lib/listing-images';
import { listReviewsForSeller, submitSellerResponse } from '$lib/server/reviews';
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
	const { data: rows } = await supabase
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
		.order('created_at', { ascending: false });

	const sales = (rows ?? []).map((o) => ({
		id: o.id,
		status: o.status,
		amountTotal: o.amount_total,
		commissionAmount: o.commission_amount,
		sellerNet: o.seller_net,
		createdAt: o.created_at,
		paidAt: o.paid_at,
		listingId: o.listing_id,
		title: o.listings?.title ?? 'Listing no longer available',
		coverUrl: o.listings ? getCoverUrl(supabase, o.listings) : null,
		// profiles are world-readable, so the seller's own client resolves the
		// buyer's display name without any service-role escalation.
		buyerName: o.profiles?.full_name ?? 'Buyer'
	}));

	// Earned so far: only completed orders are payout-eligible (D5), so that is
	// the figure worth surfacing rather than a total of everything ever started.
	const completedNet = sales
		.filter((s) => s.status === 'completed')
		.reduce((sum, s) => sum + (s.sellerNet ?? 0), 0);

	// Reviews buyers left on this seller's listings (Section 6). Fetched
	// independently of `sales` rather than joined onto it: a review outlives the
	// window this list shows, and the reviews section is its own block on the page
	// rather than a column in the sales table.
	const reviews = await listReviewsForSeller(supabase, user!.id, REVIEW_CAP);

	return { sales, completedNet, reviews };
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

		// POST-redirect-get, matching every other write in the app.
		redirect(303, '/sell/sales');
	}
};
