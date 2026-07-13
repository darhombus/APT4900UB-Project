import { redirect } from '@sveltejs/kit';
import { requireUser, getProfileRole } from '$lib/server/guards';
import type { LayoutServerLoad } from './$types';

/**
 * Guard for /sell: sellers and admins get through. A buyer is not shown a bare
 * error — instead every /sell page except the onboarding form redirects them to
 * /sell/onboarding, where they can upgrade. (The (protected) layout already
 * enforced authentication.)
 */
export const load: LayoutServerLoad = async ({ locals, url }) => {
	requireUser(locals, url);
	const role = await getProfileRole(locals);
	const onboarding = url.pathname === '/sell/onboarding';

	if (role === 'seller' || role === 'admin') {
		// Already a seller — no need to see the onboarding form.
		if (onboarding) redirect(303, '/sell');
		return { role };
	}

	// Buyer (or missing role): only the onboarding page is reachable under /sell.
	if (!onboarding) redirect(303, '/sell/onboarding');
	return { role };
};
