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
		.select(
			'id, status, amount_total, created_at, listing_id, listings(title, type, listing_images(storage_path, position))'
		)
		.eq('buyer_id', user!.id)
		.order('created_at', { ascending: false });

	const orders = (rows ?? []).map((o) => ({
		id: o.id,
		status: o.status,
		amountTotal: o.amount_total,
		createdAt: o.created_at,
		listingId: o.listing_id,
		title: o.listings?.title ?? 'Listing no longer available',
		coverUrl: o.listings ? getCoverUrl(supabase, o.listings) : null,
		isService: o.listings?.type === 'service'
	}));

	return { orders };
};
