import { error, fail, redirect } from '@sveltejs/kit';
import { createSupabaseAdmin } from '$lib/server/supabase-admin';
import { cancelCheckout } from '$lib/server/checkout';
import { findConversation } from '$lib/server/messaging';
import { coverPath, publicUrl } from '$lib/listing-images';
import type { Actions, PageServerLoad } from './$types';

/**
 * A buyer's single order (Checkout PRD — Section 9).
 *
 * `commission_amount` and `seller_net` are deliberately NOT selected: the buyer
 * has no business seeing the platform's cut, and not fetching it is a stronger
 * guarantee than fetching it and remembering not to render it.
 */
// One string literal, not a concatenation: supabase-js infers the row type from
// the literal, and `a + b` widens it to `string` (every field then types as
// GenericStringError).
const ORDER_COLUMNS =
	'id, status, buyer_id, seller_id, listing_id, amount_total, paystack_reference, paystack_authorization_url, created_at, paid_at, completed_at, cancelled_at, expired_at';

export const load: PageServerLoad = async ({ params, locals: { supabase, user } }) => {
	// RLS scopes this to orders the caller is party to; the buyer check below
	// makes it the buyer's page specifically. 404 rather than 403 — a seller
	// poking at an order id learns nothing about whether it exists.
	const { data: order } = await supabase
		.from('orders')
		.select(ORDER_COLUMNS)
		.eq('id', params.id)
		.maybeSingle();

	if (!order || order.buyer_id !== user!.id) error(404, 'Order not found');

	// Listing metadata via the service-role client, scoped to this listing. The
	// listing is `sold` by now, and a later soft-delete would hide it from the
	// buyer entirely — an order's record must not stop rendering because of that.
	// (Same deliberate, minimal read as $lib/server/messaging's fetchListingMeta.)
	const admin = createSupabaseAdmin();
	const { data: listing } = await admin
		.from('listings')
		.select('id, title, status, listing_images(storage_path, position)')
		.eq('id', order.listing_id)
		.maybeSingle();

	const cover = listing ? coverPath(listing.listing_images) : null;

	// Messaging gating, mirroring startConversation: a NEW conversation needs an
	// ACTIVE listing, but an existing thread stays writable on a sold listing
	// (messaging D3). So: link to the thread if one exists; otherwise offer to
	// start one only while the listing is still active; otherwise hide the link
	// rather than presenting a dead end.
	const conversationId = await findConversation(supabase, order.listing_id, user!.id);
	const messageHref = conversationId
		? `/messages/${conversationId}`
		: listing?.status === 'active'
			? `/listings/${order.listing_id}`
			: null;

	return {
		order: {
			id: order.id,
			status: order.status,
			amountTotal: order.amount_total,
			reference: order.paystack_reference,
			authorizationUrl: order.paystack_authorization_url,
			created_at: order.created_at,
			paid_at: order.paid_at,
			completed_at: order.completed_at,
			cancelled_at: order.cancelled_at,
			expired_at: order.expired_at
		},
		listing: {
			id: order.listing_id,
			title: listing?.title ?? 'Listing no longer available',
			status: listing?.status ?? null,
			coverUrl: cover ? publicUrl(admin, cover) : null,
			// A deleted/removed listing isn't publicly reachable, so don't link to it.
			href:
				listing?.status === 'active' || listing?.status === 'sold'
					? `/listings/${order.listing_id}`
					: null
		},
		messageHref
	};
};

export const actions: Actions = {
	// Buyer confirms receipt: paid → completed. The definer function enforces
	// both the caller and the from-status, so a forged POST can't complete
	// someone else's order or skip the paid step.
	confirmReceipt: async ({ params, locals: { supabase } }) => {
		const { error: rpcError } = await supabase.rpc('complete_order', { p_order_id: params.id });
		if (rpcError) {
			return fail(400, { formError: 'That order could no longer be confirmed.' });
		}
		// POST-redirect-get so a refresh can't re-submit.
		redirect(303, `/account/orders/${params.id}`);
	},

	// Buyer releases their own hold — the same path the listing page uses.
	cancelCheckout: async ({ params, locals: { supabase } }) => {
		const result = await cancelCheckout(supabase, params.id);
		if (!result.ok) return fail(400, { formError: result.error });
		redirect(303, `/account/orders/${params.id}`);
	}
};
