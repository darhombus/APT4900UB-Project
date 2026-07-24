import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { LayoutLoad } from './$types';
import type { Database } from '$lib/types/database';

/**
 * Universal load: creates the Supabase client used by the app and forwards the
 * server-validated auth state.
 *
 * The `session` and `user` come straight from `+layout.server.ts` (populated by
 * `safeGetSession()` -> `getClaims()` in hooks.server.ts). We deliberately do NOT
 * call the browser client's `getSession()`/`getUser()` here: right after a
 * full-page-load login the freshly-set auth cookie hasn't settled, so the browser
 * `getSession()` transiently returns null. That made the client's first render
 * disagree with SSR (server logged-in, client logged-out) and Svelte bailed
 * hydration on logged-in pages, leaving event handlers unwired. Trusting the
 * server-validated `data` makes both renders agree; the `onAuthStateChange`
 * subscription in the root layout + `invalidate('supabase:auth')` (declared here)
 * keep the client in sync as the session subsequently changes.
 */
export const load: LayoutLoad = async ({ data, depends, fetch }) => {
	depends('supabase:auth');

	const supabase = isBrowser()
		? createBrowserClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
				global: { fetch }
			})
		: createServerClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
				global: { fetch },
				cookies: {
					getAll: () => data.cookies
				}
			});

	return {
		supabase,
		session: data.session,
		user: data.user,
		profile: data?.profile ?? null,
		isSeller: data?.isSeller ?? false,
		unreadCount: data?.unreadCount ?? 0,
		categoryTree: data?.categoryTree ?? []
	};
};
