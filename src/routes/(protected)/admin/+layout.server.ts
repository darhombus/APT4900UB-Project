import { requireRole } from '$lib/server/guards';
import type { LayoutServerLoad } from './$types';

/**
 * Guard for /admin: admins only. `hide: true` returns 404 (not 403) to everyone
 * else, so the route's existence isn't advertised to non-admins.
 */
export const load: LayoutServerLoad = async ({ locals, url }) => {
	const role = await requireRole(locals, url, ['admin'], { hide: true });
	return { role };
};
