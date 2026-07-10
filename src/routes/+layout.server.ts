import type { LayoutServerLoad } from './$types';

/**
 * Runs on the server for every route. Passes the validated session down to the
 * universal load, and forwards cookies so the browser/server clients created in
 * +layout.ts stay in sync.
 */
export const load: LayoutServerLoad = async ({ locals: { safeGetSession }, cookies }) => {
	const { session } = await safeGetSession();
	return {
		session,
		cookies: cookies.getAll()
	};
};
