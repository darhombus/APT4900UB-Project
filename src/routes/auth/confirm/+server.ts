import type { EmailOtpType } from '@supabase/supabase-js';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Landing point for email links: sign-up verification and password recovery.
 * Supabase sends the user here with `token_hash` and `type` query params (and an
 * optional `next`). We exchange them for a session via verifyOtp, then redirect
 * to `next`. Password recovery passes `next=/reset-password` explicitly; sign-up
 * verification has no target, so it defaults to the browse/listings page (`/`).
 * On failure we send them to /login so they can retry or request a fresh link.
 */
export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const token_hash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type') as EmailOtpType | null;
	const next = url.searchParams.get('next') ?? '/';

	if (token_hash && type) {
		const { error } = await supabase.auth.verifyOtp({ type, token_hash });
		if (!error) {
			// Session cookie is set by the server client; land on the target page.
			redirect(303, next);
		}
	}

	redirect(303, '/login?error=verification_failed');
};
