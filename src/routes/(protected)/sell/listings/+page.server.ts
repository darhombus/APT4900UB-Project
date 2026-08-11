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
			'id, title, price, status, created_at, condition, location_area, type, boosted_until, listing_images(storage_path, position)'
		)
		.eq('seller_id', user!.id)
		.order('created_at', { ascending: false });
	const all = rows ?? [];

	// One `now` for the whole page, so two rows can never disagree about whether
	// the same instant has passed, and the tab count can never disagree with the
	// rows it counts. Decided the same way the ranking term decides it — a boost
	// whose window has closed reads as not boosted even if the expiry job has not
	// tidied its row yet.
	const now = Date.now();
	const boosted = (l: (typeof all)[number]) =>
		!!l.boosted_until && new Date(l.boosted_until).getTime() > now;

	const counts = {
		all: all.length,
		draft: all.filter((l) => l.status === 'draft').length,
		active: all.filter((l) => l.status === 'active').length,
		paused: all.filter((l) => l.status === 'paused').length,
		sold: all.filter((l) => l.status === 'sold').length,
		// Not a status — an attribute, and always a subset of `active`. The tab row
		// is already a set of views rather than a strict lifecycle ("All" is not a
		// status either), so this sits in it without lying about anything.
		boosted: all.filter(boosted).length
	};

	const listings = all.map((l) => ({
		id: l.id,
		isBoosted: boosted(l),
		// The raw window, for the row to render. Sent only when live: an expired
		// date on screen is worse than none, and `isBoosted` already gates display.
		boostedUntil: boosted(l) ? l.boosted_until : null,
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
