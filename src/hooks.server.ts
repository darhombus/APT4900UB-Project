import { createServerClient } from '@supabase/ssr';
import { type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { Database } from '$lib/types/database';

/**
 * First handle: a per-request Supabase client wired to SvelteKit cookies, exposed
 * as `event.locals.supabase`. Also provides `event.locals.safeGetSession`, which
 * validates the JWT before trusting the cookie session — always use it instead of
 * a bare getSession() on the server.
 */
const supabase: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createServerClient<Database>(
		PUBLIC_SUPABASE_URL,
		PUBLIC_SUPABASE_ANON_KEY,
		{
			cookies: {
				getAll: () => event.cookies.getAll(),
				setAll: (cookiesToSet) => {
					cookiesToSet.forEach(({ name, value, options }) => {
						event.cookies.set(name, value, { ...options, path: '/' });
					});
				}
			}
		}
	);

	/**
	 * Validate the caller's JWT before trusting the cookie session.
	 *
	 * getSession() only reads (and refreshes) the cookie — it does NOT verify the
	 * token. We therefore verify with getClaims(): with the project's asymmetric
	 * signing keys this is a LOCAL cryptographic check (the JWKS is fetched once
	 * and cached on the client), so it costs no Auth-server round-trip. This
	 * replaced getUser(), which hit the Auth server on EVERY request (~130ms+
	 * measured locally, worse over the network) and made every navigation drag —
	 * that per-request tax was the app-wide slowness. getClaims() transparently
	 * falls back to a network getUser() only for legacy HS256 tokens, so security
	 * is unchanged: an unsigned/tampered/expired token never validates.
	 *
	 * Trade-off (accepted): a still-valid token whose user was deleted/banned
	 * server-side stays trusted until it expires (≤1h), rather than being caught
	 * at the next request. Standard for JWT verification and fine here.
	 */
	event.locals.safeGetSession = async () => {
		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();
		if (!session) {
			return { session: null, user: null };
		}

		const { error } = await event.locals.supabase.auth.getClaims(session.access_token);
		if (error) {
			// Signature/expiry check failed — treat as unauthenticated.
			return { session: null, user: null };
		}

		// The token is verified, so session.user (decoded from that same token —
		// id, email, user_metadata) is now trustworthy for downstream consumers.
		return { session, user: session.user };
	};

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};

/**
 * Second handle: resolve the validated session/user once per request and stash
 * them on locals, so load functions and form actions can read `locals.session`
 * and `locals.user` cheaply without each re-validating the JWT. Route
 * protection is layered on top of these in Section 6's guards.
 */
const auth: Handle = async ({ event, resolve }) => {
	const { session, user } = await event.locals.safeGetSession();
	event.locals.session = session;
	event.locals.user = user;
	return resolve(event);
};

export const handle: Handle = sequence(supabase, auth);
