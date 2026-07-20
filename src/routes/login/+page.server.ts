import { fail, redirect } from '@sveltejs/kit';
import { loginSchema, fieldErrors } from '$lib/validation/auth';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';

// Abuse protection is handled by Supabase auth rate limits + the platform edge
// (Vercel/Cloudflare); no custom rate limiting here. See auth PRD Section 5.

export const load: PageServerLoad = async ({ locals: { session } }) => {
	if (session) redirect(303, '/account');
};

/** Only allow same-site, absolute-path redirect targets (no protocol-relative).
 *  With no target, land on the browse/listings page (the home grid) — a user
 *  bounced here from a protected page keeps returning there via `redirectTo`. */
function safeRedirect(target: string | null): string {
	if (target && target.startsWith('/') && !target.startsWith('//')) return target;
	return '/';
}

export const actions: Actions = {
	// Named (not `default`) because this page also has a `resend` action, and
	// SvelteKit forbids mixing a default action with named ones.
	login: async ({ request, locals: { supabase } }) => {
		const form = await request.formData();
		const raw = {
			email: String(form.get('email') ?? ''),
			password: String(form.get('password') ?? '')
		};

		const parsed = loginSchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, { errors: fieldErrors(parsed.error), values: { email: raw.email } });
		}

		const { error } = await supabase.auth.signInWithPassword(parsed.data);
		if (error) {
			const unverified = error.code === 'email_not_confirmed';
			return fail(400, {
				formError: unverified
					? 'Your email is not verified yet. Check your inbox, or resend the link below.'
					: 'Invalid email or password.',
				unverified,
				values: { email: raw.email }
			});
		}

		redirect(303, safeRedirect(String(form.get('redirectTo') ?? '')));
	},

	resend: async ({ request, url, locals: { supabase } }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '');

		const parsed = z.email().safeParse(email);
		if (!parsed.success) {
			return fail(400, { resendError: 'Enter a valid email to resend the link.' });
		}

		// Resend the sign-up confirmation. Errors are swallowed to avoid leaking
		// whether the address exists / is already confirmed.
		await supabase.auth.resend({
			type: 'signup',
			email: parsed.data,
			options: { emailRedirectTo: `${url.origin}/auth/confirm` }
		});

		return { resent: true, email: parsed.data };
	}
};
