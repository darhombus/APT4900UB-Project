import { getCoverUrl } from '$lib/listing-images';
import type { PageServerLoad } from './$types';

/**
 * The seller's sales (Checkout PRD — Section 9, route per R-6).
 *
 * Lives under /sell so it inherits that group's role guard — no duplicate check
 * here. Read-only this phase: sellers take no order actions until payouts.
 *
 * Unlike the buyer's view this DOES select `commission_amount` and `seller_net`.
 * The seller is entitled to see the split — it is their money — and the payouts
 * phase reads the same `seller_net`.
 */
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

	return { sales, completedNet };
};
