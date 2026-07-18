import { loadCategoryTree } from '$lib/server/categories';
import { saveListingAction } from '$lib/server/listings';
import type { Actions, PageServerLoad } from './$types';

// The /sell group layout already restricts this route to sellers/admins, and RLS
// independently blocks any non-seller insert.
export const load: PageServerLoad = async ({ locals: { supabase, user } }) => {
	const categoryTree = await loadCategoryTree(supabase);
	return { categoryTree, sellerId: user!.id };
};

export const actions: Actions = {
	// A new-page save with no hidden `listingId` inserts a fresh row; once a draft
	// exists (created so photos could attach), the id rides in the form and the
	// same action updates it.
	saveDraft: (event) => saveListingAction(event, 'draft'),
	publish: (event) => saveListingAction(event, 'publish')
};
