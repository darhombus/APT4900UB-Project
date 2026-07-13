import { error, redirect } from '@sveltejs/kit';
import type { Database } from '$lib/types/database';

type UserRole = Database['public']['Enums']['user_role'];

/**
 * Load the caller's profile role once per request and memoize it on locals, so
 * multiple guards (e.g. nested group layouts) don't each hit the database.
 * Returns null when unauthenticated or the profile row is missing.
 */
export async function getProfileRole(locals: App.Locals): Promise<UserRole | null> {
	const { user, supabase } = locals;
	if (!user) return null;
	// Promise.resolve() turns the Supabase query (a thenable) into a real Promise
	// we can cache; the `??` + assignment memoizes it for the rest of the request.
	return (locals.roleCache ??= Promise.resolve(
		supabase.from('profiles').select('role').eq('id', user.id).single()
	).then(({ data }) => data?.role ?? null));
}

/**
 * Require an authenticated user. Redirects to /login with a redirectTo back to
 * the current path when unauthenticated. Returns the user for convenience.
 */
export function requireUser(locals: App.Locals, url: URL) {
	if (!locals.session || !locals.user) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
	}
	return locals.user;
}

/**
 * Require the caller to hold one of `allowed` roles. Unauthenticated users are
 * redirected to login; authenticated-but-insufficient users get a 403 — or a 404
 * when `hide` is set, so a route's existence isn't advertised (used for /admin).
 */
export async function requireRole(
	locals: App.Locals,
	url: URL,
	allowed: UserRole[],
	opts: { hide?: boolean } = {}
): Promise<UserRole> {
	requireUser(locals, url);
	const role = await getProfileRole(locals);
	if (!role || !allowed.includes(role)) {
		error(opts.hide ? 404 : 403);
	}
	return role;
}
