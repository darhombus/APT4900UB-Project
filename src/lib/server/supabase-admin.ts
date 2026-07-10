import { createClient } from '@supabase/supabase-js';
import { env } from '$lib/server/env';
import type { Database } from '$lib/types/database';

/**
 * ⚠️ SERVER-ONLY. Returns a Supabase client authenticated with the service-role
 * (secret) key, which **BYPASSES Row Level Security**. Use it only for trusted
 * server work — payment webhooks, the order state machine, admin jobs — inside
 * `+server.ts`, `+page.server.ts`, `hooks.server.ts`, or `src/lib/server/**`.
 * Never import this into client-reachable code (SvelteKit blocks that at build
 * time because this module lives under `src/lib/server/` and reads a private env
 * var, but treat it as radioactive regardless).
 *
 * `persistSession`/`autoRefreshToken` are off: this client is stateless and must
 * never carry a user session.
 */
export function createSupabaseAdmin() {
	return createClient<Database>(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
		auth: {
			persistSession: false,
			autoRefreshToken: false
		}
	});
}
