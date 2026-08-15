import { error } from '@sveltejs/kit';
import { loadCategoryTree } from '$lib/server/categories';
import { getProfileRole } from '$lib/server/guards';
import { saveListingAction } from '$lib/server/listings';
import type { Actions, PageServerLoad } from './$types';

// The /sell group layout restricts this route to sellers/admins, and RLS
// independently blocks any non-seller insert.
//
// BST-20: an ADMIN is admitted by that layout (ADM-2 keeps their /sell entry)
// but cannot create a listing — listings_insert requires is_seller() alone
// since BST-19. Left as it was, an admin would fill in the whole form and get
// `fail(500, 'Could not create your listing. Please try again.')`, a retry that
// can never succeed. Refusing here says the true reason before any work is
// wasted. 403 rather than 404: the route exists and they may not use it, which
// is not the same as concealment.
export const load: PageServerLoad = async ({ locals }) => {
	const role = await getProfileRole(locals);
	if (role !== 'seller') {
		error(403, 'Listing creation is for seller accounts. Admin accounts cannot post listings.');
	}

	const categoryTree = await loadCategoryTree(locals.supabase);
	return { categoryTree, sellerId: locals.user!.id };
};

/**
 * The load guard covers the page; these cover a direct POST, which is a
 * separate door into the same refusal. Without this an admin posting the form
 * by hand still lands on the generic fail(500) BST-20 exists to remove.
 */
async function refuseNonSellers(locals: App.Locals) {
	const role = await getProfileRole(locals);
	if (role !== 'seller') {
		error(403, 'Listing creation is for seller accounts. Admin accounts cannot post listings.');
	}
}

export const actions: Actions = {
	// A new-page save with no hidden `listingId` inserts a fresh row; once a draft
	// exists (created so photos could attach), the id rides in the form and the
	// same action updates it.
	saveDraft: async (event) => {
		await refuseNonSellers(event.locals);
		return saveListingAction(event, 'draft');
	},
	publish: async (event) => {
		await refuseNonSellers(event.locals);
		return saveListingAction(event, 'publish');
	}
};
