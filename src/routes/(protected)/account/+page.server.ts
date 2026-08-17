import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * /account is a 303 to /account/profile (ADM-40).
 *
 * The two pages had grown into one thing read twice: /account displayed name,
 * email, phone and role read-only and linked to /account/profile, which edited
 * name, phone and location and held the NTF-4 toggle and the password form.
 * ADM-40 merged them into /account/profile.
 *
 * NOTHING INSIDE THE APP POINTS HERE ANY MORE, AND THE ROUTE STAYS ANYWAY.
 * ADM-41 repointed every internal link and redirect — both Account nav entries,
 * the already-signed-in bounces on /login and /signup, and the onboarding page's
 * "back to my account" — straight at /account/profile, because a link to a
 * redirect costs a second serverless invocation and on a cold tier that
 * round-trip IS the latency (the same reasoning recorded at
 * CategoryDrawer.svelte's Sell link).
 *
 * So this is deliberately a route with no internal callers. It is the catch-all
 * for the arrivals nobody controls: bookmarks, typed URLs, links shared or
 * indexed before the merge, and anything external. Those cannot be repointed,
 * and deleting this route would 404 every one of them silently — which is
 * exactly the failure a redirect exists to prevent. Do not remove it because
 * "nothing links to it": that is the point, and e2e asserts the 303 so the
 * removal cannot pass quietly.
 *
 * 303, matching every other redirect in the app: the arriving request may be a
 * POST, and 303 tells the browser to follow with a GET rather than replay the
 * body.
 */
export const load: PageServerLoad = () => {
	redirect(303, '/account/profile');
};
