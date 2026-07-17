import { getCoverUrl } from '$lib/listing-images';
import { transitionListing, type ListingTransition } from '$lib/server/listings';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

const TABS = ['all', 'draft', 'active', 'paused', 'sold'] as const;
type Tab = (typeof TABS)[number];

// The /sell group layout already restricts this route to sellers/admins.
export const load: PageServerLoad = async ({ url, locals: { supabase, user } }) => {
	const { data } = await supabase
		.from('listings')
		.select(
			'id, title, price, status, created_at, condition, location_area, listing_images(storage_path, position)'
		)
		.eq('seller_id', user!.id)
		.order('created_at', { ascending: false });

	const listings = data ?? [];
	const counts = {
		all: listings.length,
		draft: listings.filter((l) => l.status === 'draft').length,
		active: listings.filter((l) => l.status === 'active').length,
		paused: listings.filter((l) => l.status === 'paused').length,
		sold: listings.filter((l) => l.status === 'sold').length
	};

	const param = url.searchParams.get('tab');
	const tab: Tab = (TABS as readonly string[]).includes(param ?? '') ? (param as Tab) : 'all';
	const visible = (tab === 'all' ? listings : listings.filter((l) => l.status === tab)).map(
		(l) => ({
			id: l.id,
			title: l.title,
			price: l.price,
			status: l.status,
			created_at: l.created_at,
			condition: l.condition,
			location_area: l.location_area,
			coverUrl: getCoverUrl(supabase, l)
		})
	);

	return { listings: visible, counts, tab };
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
