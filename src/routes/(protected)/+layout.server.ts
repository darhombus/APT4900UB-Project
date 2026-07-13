import { requireUser, getProfileRole } from '$lib/server/guards';
import type { LayoutServerLoad } from './$types';

/**
 * Guard for the whole (protected) group: every child route requires an
 * authenticated user. Runs before child group layouts, so /sell and /admin layer
 * their role checks on top. Exposes email + role to all protected pages.
 */
export const load: LayoutServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals, url);
	const role = await getProfileRole(locals);
	return { email: user.email, role };
};
