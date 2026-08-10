import { createClient } from '@supabase/supabase-js';
import { env } from '$lib/server/env';
import type { Database } from '$lib/types/database';

/** The path+query of a request, for logging. Never the host: it adds nothing. */
function describe(input: RequestInfo | URL): string {
	const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
	try {
		const url = new URL(raw);
		return url.pathname + url.search;
	} catch {
		return raw;
	}
}

/**
 * `fetch` that refuses to let a failed admin request pass unnoticed.
 *
 * Every caller of this client reads `const { data } = await …` and lets the
 * error fall on the floor. That is right for "this listing really is gone" and
 * catastrophic for "the credential is dead" — the two are indistinguishable at
 * the call site, because both arrive as `data: null`.
 *
 * They were indistinguishable in production too: a revoked service key made
 * every admin request 401, and the app rendered that as "Listing no longer
 * available" on every order and "Unavailable listing" on every conversation for
 * days, while checkout's pending-order lookup failed the same way. Nothing was
 * logged, because nothing looked at the error.
 *
 * Logging here rather than at the ~15 call sites is deliberate: one wrapper
 * covers the Paystack webhook, checkout, the Inngest jobs, orders, messaging and
 * reviews alike, and no future call site can opt out of it by forgetting to.
 */
async function loudFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const res = await fetch(input, init);
	if (!res.ok) {
		// `clone()` so the body is still intact for supabase-js to parse.
		let detail = '';
		try {
			detail = (await res.clone().text()).slice(0, 300);
		} catch {
			// Body already consumed or not readable — the status is the useful part.
		}
		// 401/403 is never a data condition: it means the key itself was rejected,
		// so name the variable to check rather than leaving a bare status code.
		const cause =
			res.status === 401 || res.status === 403
				? ' — SERVICE-ROLE KEY REJECTED, check SUPABASE_SERVICE_ROLE_KEY'
				: '';
		console.error(
			`[supabase-admin] ${init?.method ?? 'GET'} ${describe(input)} → ${res.status}${cause}`,
			detail
		);
	}
	return res;
}

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
		},
		// See loudFetch: a dead credential must not read as "everything was deleted".
		global: { fetch: loudFetch }
	});
}
