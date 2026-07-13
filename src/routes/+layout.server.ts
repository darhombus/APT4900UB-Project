import type { LayoutServerLoad } from './$types';

/**
 * Runs on the server for every route. `locals.session` is already the validated
 * session (the `auth` handle in hooks.server.ts resolved it via getUser once for
 * this request), so we pass it straight down to the universal load and forward
 * the cookies that +layout.ts uses to seed the browser/server clients.
 */
export const load: LayoutServerLoad = async ({ locals: { session }, cookies }) => {
	return {
		session,
		cookies: cookies.getAll()
	};
};
