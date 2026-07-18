import { getCoverUrl } from '$lib/listing-images';
import { transitionListing, type ListingTransition } from '$lib/server/listings';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

const TABS = ['all', 'draft', 'active', 'paused', 'sold'] as const;
type Tab = (typeof TABS)[number];

// The /sell group layout already restricts this route to sellers/admins.
export const load: PageServerLoad = async ({ url, locals: { supabase, user } }) => {
	const param = url.searchParams.get('tab');
	const tab: Tab = (TABS as readonly string[]).includes(param ?? '') ? (param as Tab) : 'all';

	// Scope the heavy query to the active tab's rows (with cover images) instead of
	// fetching every listing + its images on every tab change. The badge counts come
	// from a cheap status-only scan — and when the tab is "all" the rows already span
	// every status, so we reuse them and skip that extra query.
	let rowsQuery = supabase
		.from('listings')
		.select(
			'id, title, price, status, created_at, condition, location_area, listing_images(storage_path, position)'
		)
		.eq('seller_id', user!.id)
		.order('created_at', { ascending: false });
	if (tab !== 'all') rowsQuery = rowsQuery.eq('status', tab);

	const countsPromise =
		tab === 'all' ? null : supabase.from('listings').select('status').eq('seller_id', user!.id);

	const [rowsRes, countsRes] = await Promise.all([rowsQuery, countsPromise]);
	const rows = rowsRes.data ?? [];
	const statusRows = countsRes?.data ?? rows;

	const counts = {
		all: statusRows.length,
		draft: statusRows.filter((l) => l.status === 'draft').length,
		active: statusRows.filter((l) => l.status === 'active').length,
		paused: statusRows.filter((l) => l.status === 'paused').length,
		sold: statusRows.filter((l) => l.status === 'sold').length
	};

	const visible = rows.map((l) => ({
		id: l.id,
		title: l.title,
		price: l.price,
		status: l.status,
		created_at: l.created_at,
		condition: l.condition,
		location_area: l.location_area,
		coverUrl: getCoverUrl(supabase, l)
	}));

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
