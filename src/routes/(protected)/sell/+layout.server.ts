import { redirect } from '@sveltejs/kit';
import { requireUser, getProfileRole } from '$lib/server/guards';
import type { LayoutServerLoad } from './$types';

/**
 * Guard for /sell: sellers get through, admins are redirected to /admin
 * (ADM-25). A buyer is not shown a bare error — instead every /sell page except
 * the onboarding form redirects them to /sell/onboarding, where they can
 * upgrade. (The (protected) layout already enforced authentication.)
 */
export const load: LayoutServerLoad = async ({ locals, url, route }) => {
	requireUser(locals, url);
	const role = await getProfileRole(locals);
	// Use route.id, not url.pathname: reading `url` here would make this guard re-run
	// on every in-page query-string change (e.g. the /sell/listings ?tab= tabs),
	// adding a needless server round-trip. route.id only changes on a real route
	// change, so the guard runs once and the tabs stay a pure client-side filter.
	const onboarding = route.id === '/(protected)/sell/onboarding';

	// ADM-25 — /sell/* is closed to admins. ADM-17 SUPERSEDES ADM-2 for this
	// route: ADM-2 admitted admins here deliberately, and that admission is now
	// withdrawn. Every /sell surface renders the admin's OWN seller data —
	// their listings, their sales, their payouts — and BST-19 keeps an admin
	// permanently unable to create a listing, so those three pages are
	// structurally empty for them and offer zero verification value.
	//
	// MUST STAY ABOVE THE DISJUNCTION BELOW. If this ran inside or after it, an
	// admin hitting /sell/onboarding would take that branch's redirect to
	// /sell/listings and never reach /admin. e2e/admin-landing.spec.ts pins
	// /sell/onboarding specifically for exactly that reason — /sell/listings
	// alone would still look correct with the branches in the wrong order.
	//
	// The disjunction below is deliberately left reading `seller || admin`. It
	// is seller-only in effect because this branch has already returned, and
	// rewriting it belongs to ADM-28's signal work, not here — doing both in
	// one phase makes each change harder to attribute.
	//
	// KNOWN LIMITATION, stated plainly rather than papered over: a seller who is
	// promoted to admin while still holding listings, in-flight sales or pending
	// payouts keeps that state with NO route to it. That case is closed by
	// PROCEDURE, not by code — ADM-30 requires seller-side wind-down before
	// promotion, and ADM-32 records that requirement on profiles.role, where
	// whoever runs the promotion SQL will actually encounter it. Nothing detects
	// or prevents a violation. If it happens, the remedy is service role.
	if (role === 'admin') redirect(303, '/admin');

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
