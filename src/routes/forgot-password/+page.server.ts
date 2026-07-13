import { fail } from '@sveltejs/kit';
import { forgotPasswordSchema, fieldErrors } from '$lib/validation/auth';
import type { Actions } from './$types';

// No custom rate limiting — Supabase auth limits + platform edge handle abuse.

export const actions: Actions = {
	default: async ({ request, url, locals: { supabase } }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '');

		const parsed = forgotPasswordSchema.safeParse({ email });
		if (!parsed.success) {
			return fail(400, { errors: fieldErrors(parsed.error), values: { email } });
		}

		// Fire-and-forget: send the recovery link to /auth/confirm, which exchanges
		// the token and forwards to /reset-password. We ignore the result and always
		// return the same neutral confirmation so the response never reveals whether
		// an account exists for this address.
		await supabase.auth.resetPasswordForEmail(parsed.data.email, {
			redirectTo: `${url.origin}/auth/confirm?next=/reset-password`
		});

		return { sent: true };
	}
};
