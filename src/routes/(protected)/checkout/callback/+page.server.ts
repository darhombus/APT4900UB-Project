import { error } from '@sveltejs/kit';
import { createSupabaseAdmin } from '$lib/server/supabase-admin';
import { getPaystackClient } from '$lib/server/paystack';
import { processPaymentReference } from '$lib/server/payment-processing';
import { coverPath, publicUrl } from '$lib/listing-images';
import type { PageServerLoad } from './$types';

/**
 * Where Paystack sends the buyer after payment (Checkout PRD — Section 8).
 *
 * This page is the SECOND of two paths to a finalised order; the webhook is the
 * first and usually wins. D10 is what makes running both safe: the reference is
 * the idempotency key, and whichever path arrives second finds the order already
 * terminal and does nothing. The page therefore never waits on the webhook — it
 * verifies and finalises directly, so a buyer whose webhook is delayed still
 * gets a confirmed order rather than a spinner.
 *
 * It lives under (protected), so an expired session is redirected to login with
 * a redirectTo that preserves ?reference — the buyer comes straight back here.
 */

/** What the page renders. Derived from the order's status, never from Paystack. */
export type CallbackState = 'success' | 'pending' | 'failed';

function stateFor(status: string): CallbackState {
	if (status === 'paid' || status === 'completed') return 'success';
	if (status === 'pending_payment') return 'pending';
	return 'failed'; // cancelled | expired
}

export const load: PageServerLoad = async ({ url, locals: { supabase, user } }) => {
	// Paystack sends `reference`; some flows send `trxref`. Accept both, prefer
	// `reference`.
	const reference = url.searchParams.get('reference') ?? url.searchParams.get('trxref');
	if (!reference) error(400, 'Missing payment reference');

	// The caller's OWN client: orders_select scopes this to orders where they are
	// buyer or seller, so a stranger's reference simply returns nothing.
	const ORDER_COLUMNS =
		'id, status, buyer_id, listing_id, amount_total, paystack_reference, created_at, paid_at';
	const { data: initial } = await supabase
		.from('orders')
		.select(ORDER_COLUMNS)
		.eq('paystack_reference', reference)
		.maybeSingle();

	// 404 rather than 403: a wrong or unknown reference should not confirm that
	// an order exists at all.
	if (!initial) error(404, 'Order not found');

	// RLS also admits the seller. This page is the buyer's receipt, so a seller
	// landing here gets the same 404.
	if (initial.buyer_id !== user!.id) error(404, 'Order not found');

	let order = initial;

	if (order.status === 'pending_payment') {
		// The webhook hasn't landed (or hasn't been processed) yet. Verify and
		// finalise right here rather than waiting — SAME implementation the Inngest
		// function runs, so the two cannot drift apart.
		try {
			await processPaymentReference(reference, {
				paystack: getPaystackClient(),
				admin: createSupabaseAdmin()
			});

			const { data: refreshed } = await supabase
				.from('orders')
				.select(ORDER_COLUMNS)
				.eq('paystack_reference', reference)
				.maybeSingle();
			if (refreshed) order = refreshed;
		} catch (err) {
			// Infrastructure trouble (Paystack unreachable, database blip). Do NOT
			// fail the buyer's confirmation page over it — the webhook path is still
			// running and the in-progress state re-checks on its own.
			console.error('[checkout/callback] verify-and-finalize failed for %s', reference, err);
		}
	}

	// Listing metadata via the service-role client, scoped to this one listing.
	// The listing is `sold` by now and a later soft-delete would hide it from the
	// buyer entirely — an order's receipt must not stop rendering because of that.
	const admin = createSupabaseAdmin();
	const { data: listing } = await admin
		.from('listings')
		.select('id, title, status, listing_images(storage_path, position)')
		.eq('id', order.listing_id)
		.maybeSingle();

	const cover = listing ? coverPath(listing.listing_images) : null;

	return {
		state: stateFor(order.status),
		order: {
			id: order.id,
			status: order.status,
			amountTotal: order.amount_total,
			reference: order.paystack_reference,
			paidAt: order.paid_at
		},
		listing: {
			id: order.listing_id,
			title: listing?.title ?? 'Listing',
			coverUrl: cover ? publicUrl(admin, cover) : null
		}
	};
};
