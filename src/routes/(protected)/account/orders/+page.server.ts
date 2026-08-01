import { createSupabaseAdmin } from '$lib/server/supabase-admin';
import { getCoverUrl } from '$lib/listing-images';
import type { PageServerLoad } from './$types';

/**
 * The buyer's orders (Checkout PRD — Section 9).
 *
 * Read with the caller's own client: `orders_select` returns orders where they
 * are buyer OR seller, so the `buyer_id` filter is what makes this the *buyer's*
 * view — a seller's own sales live at /sell/sales. RLS is the guarantee; the
 * filter is the intent.
 *
 * `commission_amount` and `seller_net` are deliberately NOT selected. The buyer
 * has no business seeing the platform's cut, and not fetching it is stronger
 * than fetching it and remembering not to render it.
 */
export const load: PageServerLoad = async ({ locals: { supabase, user } }) => {
	const { data: rows } = await supabase
		.from('orders')
		.select('id, status, amount_total, created_at, listing_id')
		.eq('buyer_id', user!.id)
		.order('created_at', { ascending: false });

	const orderRows = rows ?? [];

	/**
	 * Listing details come from the SERVICE ROLE, matching the order detail page.
	 *
	 * An order is a receipt: a buyer must still see what they bought after the
	 * seller deletes the listing. Joining through the session client hid exactly
	 * that — RLS filters a `deleted` listing away, so the row came back with a
	 * null join and the thumbnail vanished from this list, while the detail page,
	 * which already read through the service role, still showed it. Same order,
	 * two different answers.
	 *
	 * The escalation is narrow: title, type and cover image only, and only for
	 * listings the buyer demonstrably purchased — the ids come from orders their
	 * own RLS already returned. The detail page still refuses to LINK to a
	 * deleted or removed listing; this only restores the picture.
	 */
	const listingIds = [...new Set(orderRows.map((o) => o.listing_id))];
	const admin = createSupabaseAdmin();

	const { data: listings } = listingIds.length
		? await admin
				.from('listings')
				.select('id, title, type, listing_images(storage_path, position)')
				.in('id', listingIds)
		: { data: [] };

	const byId = new Map((listings ?? []).map((l) => [l.id, l]));

	const orders = orderRows.map((o) => {
		const listing = byId.get(o.listing_id);
		return {
			id: o.id,
			status: o.status,
			amountTotal: o.amount_total,
			createdAt: o.created_at,
			listingId: o.listing_id,
			title: listing?.title ?? 'Listing no longer available',
			coverUrl: listing ? getCoverUrl(admin, listing) : null,
			isService: listing?.type === 'service'
		};
	});

	return { orders };
};
