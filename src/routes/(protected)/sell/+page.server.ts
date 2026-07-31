import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * /sell has no page of its own — it redirects to the seller's listings.
 *
 * It previously rendered a placeholder written before the listings phase
 * shipped ("Listings arrive in a later phase"), which had become a dead end
 * reachable two ways: the sidebar's "Sell on MySoko" link, and the layout
 * guard bouncing sellers here from /sell/onboarding.
 *
 * Only sellers get this far. The (protected)/sell layout guard redirects a
 * buyer to /sell/onboarding before this load runs, so there is no role check
 * to duplicate here.
 */
export const load: PageServerLoad = async () => {
	redirect(303, '/sell/listings');
};
