import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * /account is now a redirect to /account/profile (ADM-40).
 *
 * The two pages had grown into one thing read twice: /account displayed name,
 * email, phone and role read-only and linked to /account/profile, which edited
 * name and phone. ADM-40 merged them, and the three items that lived ONLY here
 * — the email display, the role badge and the buyer-gated "Become a seller" CTA
 * — moved to /account/profile rather than being dropped.
 *
 * A REDIRECT, NOT A DELETED ROUTE. Four things still point at /account and all
 * of them keep working because this exists: login/+page.server.ts and
 * signup/+page.server.ts both redirect(303, '/account') for an already-signed-in
 * visitor, sell/onboarding/+page.svelte links back to it after an upgrade, and
 * the Account entries in the header menu and the drawer. Deleting the route
 * would turn a cosmetic merge into a sweep across all of them, and would leave
 * bookmarks and any external link 404ing.
 *
 * The login and signup redirects are deliberately NOT repointed here. They land
 * on /account and bounce, which means the destination is decided in exactly one
 * place — this file — and a future move of the account page changes one line
 * rather than five.
 *
 * 303, matching every other redirect in the app: the request that arrives may be
 * a POST (the login form's), and 303 is what tells the browser to follow with a
 * GET rather than replaying the body.
 */
export const load: PageServerLoad = () => {
	redirect(303, '/account/profile');
};
