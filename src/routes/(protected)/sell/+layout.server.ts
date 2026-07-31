import { redirect } from '@sveltejs/kit';
import { requireUser, getProfileRole } from '$lib/server/guards';
import type { LayoutServerLoad } from './$types';

/**
 * Guard for /sell: sellers and admins get through. A buyer is not shown a bare
 * error — instead every /sell page except the onboarding form redirects them to
 * /sell/onboarding, where they can upgrade. (The (protected) layout already
 * enforced authentication.)
 */
export const load: LayoutServerLoad = async ({ locals, url, route }) => {
	requireUser(locals, url);
	const role = await getProfileRole(locals);
	// Use route.id, not url.pathname: reading `url` here would make this guard re-run
	// on every in-page query-string change (e.g. the /sell/listings ?tab= tabs),
	// adding a needless server round-trip. route.id only changes on a real route
	// change, so the guard runs once and the tabs stay a pure client-side filter.
	const onboarding = route.id === '/(protected)/sell/onboarding';

	if (role === 'seller' || role === 'admin') {
		// Already a seller — no need to see the onboarding form. Straight to
		// /sell/listings, not /sell: /sell only redirects here anyway, and the
		// extra hop is a second serverless invocation for nothing.
		if (onboarding) redirect(303, '/sell/listings');
		return { role };
	}

	// Buyer (or missing role): only the onboarding page is reachable under /sell.
	if (!onboarding) redirect(303, '/sell/onboarding');
	return { role };
};
