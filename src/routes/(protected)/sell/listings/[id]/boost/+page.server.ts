import { error, fail, redirect } from '@sveltejs/kit';
import { getProfileRole } from '$lib/server/guards';
import { listBoostPackages, startBoostPurchase } from '$lib/server/boosts';
import type { Actions, PageServerLoad } from './$types';

/**
 * Buy a boost for one of your own listings (Boosts PRD — Section 6.2).
 *
 * Owner-only, following the edit page's pattern exactly: RLS lets any seller read
 * any ACTIVE listing because it is public, so a successful read does not imply
 * ownership — `seller_id` is checked here and a stranger's listing 404s.
 */
export const load: PageServerLoad = async ({ params, locals: { supabase, user } }) => {
	const { data: listing } = await supabase
		.from('listings')
		.select('id, title, status, seller_id, boosted_until')
		.eq('id', params.id)
		.maybeSingle();

	if (!listing || listing.seller_id !== user!.id) error(404, 'Not found');

	const packages = await listBoostPackages(supabase);

	// The live window, decided the same way the ranking term decides it. A boost
	// whose window has passed reads as "not boosted" here even if the expiry job
	// has not tidied its row yet — the seller sees what buyers see.
	const boostedUntil =
		listing.boosted_until && new Date(listing.boosted_until).getTime() > Date.now()
			? listing.boosted_until
			: null;

	return {
		listing: { id: listing.id, title: listing.title, status: listing.status },
		packages,
		boostedUntil
	};
};

export const actions: Actions = {
	/**
	 * Create the pending purchase and hand the seller to Paystack's hosted page
	 * (the same redirect flow checkout uses — a plain form POST, no JavaScript
	 * required, no inline popup).
	 */
	purchase: async ({ params, request, url, locals }) => {
		const { supabase, user } = locals;
		const packageId = String((await request.formData()).get('packageId') ?? '');
		if (!packageId) return fail(400, { formError: 'Choose a boost package first.' });

		// BST-4's role gate. The /sell layout admits admins too, so this is not
		// redundant with it — `startBoostPurchase` requires 'seller' exactly.
		const role = await getProfileRole(locals);

		const callbackUrl = new URL('/sell/boosts/callback', url.origin).toString();
		const result = await startBoostPurchase(
			supabase,
			user!,
			role,
			params.id,
			packageId,
			callbackUrl
		);

		if (!result.ok) return fail(400, { formError: result.error });

		redirect(303, result.authorizationUrl);
	}
};
