import { getCoverUrl } from '$lib/listing-images';
import { transitionListing, type ListingTransition } from '$lib/server/listings';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

// The /sell group layout already restricts this route to sellers/admins.
//
// Deliberately reads NO `?tab=` param: the seller's listings are fetched ONCE and
// the tabs filter them client-side (see +page.svelte). Because the load doesn't
// depend on the tab, switching tabs is a pure URL change with no server round-trip
// — instant, even on touch where there's no hover preload. The badge counts also
// fall out of the single result set, so the old per-tab "counts" query is gone.
export const load: PageServerLoad = async ({ locals: { supabase, user } }) => {
	const { data: rows } = await supabase
		.from('listings')
		.select(
			'id, title, price, status, created_at, condition, location_area, type, listing_images(storage_path, position)'
		)
		.eq('seller_id', user!.id)
		.order('created_at', { ascending: false });
	const all = rows ?? [];

	const counts = {
		all: all.length,
		draft: all.filter((l) => l.status === 'draft').length,
		active: all.filter((l) => l.status === 'active').length,
		paused: all.filter((l) => l.status === 'paused').length,
		sold: all.filter((l) => l.status === 'sold').length
	};

	const listings = all.map((l) => ({
		id: l.id,
		title: l.title,
		price: l.price,
		status: l.status,
		created_at: l.created_at,
		condition: l.condition,
		location_area: l.location_area,
		coverUrl: getCoverUrl(supabase, l),
		// A photo-less service shows a service glyph tile instead of the placeholder
		// image (consistent with the service card variant).
		isService: l.type === 'service',
		hasImage: (l.listing_images?.length ?? 0) > 0
	}));

	return { listings, counts };
};

const run = async (event: RequestEvent, transition: ListingTransition) => {
	const id = String((await event.request.formData()).get('id') ?? '');
	return transitionListing(event, transition, id);
};

export const actions: Actions = {
	publish: (event) => run(event, 'publish'),
	unpublish: (event) => run(event, 'unpublish'),
	republish: (event) => run(event, 'republish'),
	markSold: (event) => run(event, 'markSold'),
	relist: (event) => run(event, 'relist'),
	delete: (event) => run(event, 'delete')
};
