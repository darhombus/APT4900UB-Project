import { fail, redirect } from '@sveltejs/kit';
import { signupSchema, fieldErrors, friendlyAuthError } from '$lib/validation/auth';
import type { Actions, PageServerLoad } from './$types';

// Abuse protection (signup flooding, credential stuffing) is intentionally NOT
// handled with custom code here: Supabase enforces its own auth rate limits, and
// the platform edge (Vercel/Cloudflare) fronts the app. See auth PRD Section 5.

export const load: PageServerLoad = async ({ locals: { session } }) => {
	if (session) redirect(303, '/account');
};

export const actions: Actions = {
	default: async ({ request, url, locals: { supabase } }) => {
		const form = await request.formData();
		const raw = {
			fullName: String(form.get('fullName') ?? ''),
			email: String(form.get('email') ?? ''),
			phone: String(form.get('phone') ?? ''),
			password: String(form.get('password') ?? '')
		};

		const parsed = signupSchema.safeParse(raw);
		if (!parsed.success) {
			// Never echo passwords back to the client; refill the safe fields only.
			return fail(400, {
				errors: fieldErrors(parsed.error),
				values: { fullName: raw.fullName, email: raw.email, phone: raw.phone }
			});
		}

		const { fullName, email, phone, password } = parsed.data;
		const { error } = await supabase.auth.signUp({
			email,
			password,
			options: {
				emailRedirectTo: `${url.origin}/auth/confirm`,
				// Picked up by the handle_new_user() trigger (Section 3).
				data: { full_name: fullName, phone }
			}
		});

		if (error) {
			// Map to safe copy — Supabase's raw message can be empty/opaque (surfaced
			// as "{}" on the hosted stack), which must never hit the UI.
			return fail(400, {
				formError: friendlyAuthError(error),
				values: { fullName, email, phone }
			});
		}

		// Supabase obfuscates whether the email was already registered, so we show
		// the same "check your email" state either way — no enumeration leak.
		return { success: true, email };
	}
};
