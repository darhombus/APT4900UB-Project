import { error } from '@sveltejs/kit';
import { loadCategoryTree } from '$lib/server/categories';
import { saveListingAction } from '$lib/server/listings';
import type { Actions, PageServerLoad } from './$types';

/**
 * Owner-only edit. RLS lets a seller read any *active* listing (it's public), so
 * ownership isn't implied by a successful read — we check seller_id and 404 when
 * the listing isn't the caller's, matching the project's not-found pattern.
 * Drafts owned by someone else aren't readable at all and also land as 404.
 */
export const load: PageServerLoad = async ({ params, locals: { supabase, user } }) => {
	const { data: listing } = await supabase
		.from('listings')
		.select(
			'id, title, description, price, category_id, condition, location_area, status, published_at, seller_id'
		)
		.eq('id', params.id)
		.maybeSingle();

	if (!listing || listing.seller_id !== user!.id) error(404, 'Not found');

	const { data: images } = await supabase
		.from('listing_images')
		.select('id, storage_path, position')
		.eq('listing_id', listing.id)
		.order('position', { ascending: true });

	const categoryTree = await loadCategoryTree(supabase);
	return { categoryTree, sellerId: user!.id, listing, images: images ?? [] };
};

export const actions: Actions = {
	saveDraft: (event) => saveListingAction(event, 'draft', event.params.id),
	publish: (event) => saveListingAction(event, 'publish', event.params.id)
};
