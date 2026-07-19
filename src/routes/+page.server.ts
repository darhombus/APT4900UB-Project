import { loadCategoryTree } from '$lib/server/categories';
import { toCardData } from '$lib/listings-view';
import type { PageServerLoad } from './$types';

// Public home — now a listings page (the grid is the page). Only active listings
// are queried (never leak drafts/sold into the grid); RLS enforces the same, this
// is the query-layer belt. The grid fills the space the removed hero freed up, so
// we fetch a fuller page of the most recent active listings.
const HOME_LIMIT = 24;

export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const [categoryTree, recentRes] = await Promise.all([
		loadCategoryTree(supabase),
		supabase
			.from('listings')
			.select(
				'id, title, price, location_area, condition, published_at, created_at, listing_images(storage_path, position)'
			)
			.eq('status', 'active')
			.order('published_at', { ascending: false })
			.order('id', { ascending: true }) // stable tiebreaker
			.limit(HOME_LIMIT)
	]);

	const recent = (recentRes.data ?? []).map((l) => toCardData(supabase, l));
	return { categoryTree, recent };
};
