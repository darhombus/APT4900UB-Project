import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * /sell has no page of its own — it forwards to wherever the caller belongs.
 *
 * It previously rendered a placeholder written before the listings phase
 * shipped ("Listings arrive in a later phase"), which had become a dead end.
 *
 * `await parent()` is load-bearing, and the first version of this file was
 * wrong about why. SvelteKit runs layout and page loads in PARALLEL, so this
 * load does NOT automatically run after the /sell layout guard — awaiting the
 * parent is what orders them. Without it a buyer's request races two redirects
 * (the guard's to /sell/onboarding and this one's to /sell/listings), and the
 * loser could cost a wasted hop.
 *
 * In practice nothing but sellers reaches the redirect below, since the guard
 * redirects buyers to onboarding and admins to /admin (ADM-25) while this load
 * is still awaiting the parent. The role check is kept regardless, so the
 * destination is right on its own terms rather than by relying on a guard in
 * another file.
 *
 * The admin arm of that check was removed in ADM-17: `parent()` returns the
 * /sell layout's `role`, and since ADM-25's branch redirects admins before
 * either of the layout's two returns, the inherited type is
 * 'seller' | 'buyer' | null — 'admin' is not in it, so the comparison was dead.
 *
 * Note this route is now rarely hit at all: the sidebar link and the onboarding
 * guard both point straight at their destination, precisely so nobody pays for
 * a redirect they don't need.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const { role } = await parent();
	redirect(303, role === 'seller' ? '/sell/listings' : '/sell/onboarding');
};
