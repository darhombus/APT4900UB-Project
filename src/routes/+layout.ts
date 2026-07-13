import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { LayoutLoad } from './$types';
import type { Database } from '$lib/types/database';

/**
 * Universal load: creates the Supabase client used by the app. In the browser
 * it's a cookie-less browser client; during SSR it's a server client seeded with
 * the cookies forwarded from +layout.server.ts. `depends('supabase:auth')` lets
 * us invalidate on auth changes.
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

	const {
		data: { session }
	} = await supabase.auth.getSession();

	const {
		data: { user }
	} = await supabase.auth.getUser();

	// Forward the server-loaded header profile (avatar + name) so the layout can
	// render it. `data` is null-safe: it's undefined only before the server load runs.
	return { supabase, session, user, profile: data?.profile ?? null };
};
