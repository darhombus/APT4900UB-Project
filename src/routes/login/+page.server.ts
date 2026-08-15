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
 *  Returns null when there is no usable target, which is what lets the caller
 *  choose a landing page by role instead (ADM-14). */
function safeRedirect(target: string | null): string | null {
	if (target && target.startsWith('/') && !target.startsWith('//')) return target;
	return null;
}

/**
 * Where a login with NO usable `redirectTo` lands (ADM-14).
 *
 * ⚠️ THIS IS THE FALLBACK ONLY. `redirectTo` always wins, and that ordering is
 * the whole ruling: ADM-9 sends an anonymous request for a deep admin route to
 * `/login?redirectTo=<encoded path AND query>`, and the probe battery asserts
 * that contract on all three tiers. An unconditional admin redirect would
 * silently discard it — an admin following a link to one dispute would land on
 * the overview instead, and the ADM-9 guarantee would be worth nothing for
 * exactly the role it exists to serve.
 *
 * Display-layer only. It changes where an admin is POINTED, never what they may
 * reach: the /admin gate is still requireRole(..., { hide: true }), and an
 * admin's /sell/* access is untouched (ADM-2 scope note).
 *
 * A REJECTED target is treated as no target. `//evil.com` and a missing field
 * both mean "no usable destination", so both fall through to the role default
 * rather than one of them landing an admin somewhere different.
 */
async function landingFor(supabase: App.Locals['supabase'], userId: string): Promise<string> {
	const { data } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle();
	return data?.role === 'admin' ? '/admin' : '/';
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

		const { data: signIn, error } = await supabase.auth.signInWithPassword(parsed.data);
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

		// redirectTo FIRST, and only then the role default — the ADM-14 ordering.
		const requested = safeRedirect(String(form.get('redirectTo') ?? ''));
		if (requested) redirect(303, requested);

		// The role read is deliberately AFTER the redirectTo check, so the ordinary
		// deep-link path costs no extra query at all.
		redirect(303, signIn.user ? await landingFor(supabase, signIn.user.id) : '/');
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
