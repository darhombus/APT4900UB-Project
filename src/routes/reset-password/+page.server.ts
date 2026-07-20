import { fail, redirect } from '@sveltejs/kit';
import { resetPasswordSchema, fieldErrors } from '$lib/validation/auth';
import type { Actions, PageServerLoad } from './$types';

// The recovery link (via /auth/confirm?next=/reset-password) establishes a
// session before landing here. No valid session means the user reached this page
// without a recovery token, so send them to log in.
export const load: PageServerLoad = async ({ locals: { session } }) => {
	if (!session) redirect(303, '/login');
};

export const actions: Actions = {
	default: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { session } = await safeGetSession();
		if (!session) redirect(303, '/login');

		const form = await request.formData();
		const parsed = resetPasswordSchema.safeParse({
			password: String(form.get('password') ?? ''),
			confirmPassword: String(form.get('confirmPassword') ?? '')
		});
		if (!parsed.success) {
			return fail(400, { errors: fieldErrors(parsed.error) });
		}

		const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
		if (error) {
			return fail(400, { formError: error.message });
		}

		// Password changed; the recovery session is still valid, so land them on the
		// browse/listings page (same default destination as a normal login).
		redirect(303, '/');
	}
};
