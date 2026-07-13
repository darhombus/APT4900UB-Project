import { fail } from '@sveltejs/kit';
import {
	profileSchema,
	resetPasswordSchema,
	fieldErrors,
	AVATAR_MAX_BYTES,
	AVATAR_TYPES,
	AVATAR_EXT
} from '$lib/validation/auth';
import type { Actions, PageServerLoad } from './$types';

// Auth is guaranteed by the (protected) group layout.
export const load: PageServerLoad = async ({ locals: { user, supabase } }) => {
	const { data: profile } = await supabase
		.from('profiles')
		.select('full_name, phone, location, avatar_url, role')
		.eq('id', user!.id)
		.single();

	return { profile, email: user!.email };
};

export const actions: Actions = {
	// ── Update editable profile fields (own row only; RLS enforces that) ─────────
	updateProfile: async ({ request, locals: { user, supabase } }) => {
		const form = await request.formData();
		const parsed = profileSchema.safeParse({
			fullName: String(form.get('fullName') ?? ''),
			phone: String(form.get('phone') ?? ''),
			location: String(form.get('location') ?? '')
		});
		if (!parsed.success) {
			return fail(400, {
				section: 'profile',
				errors: fieldErrors(parsed.error),
				values: {
					fullName: String(form.get('fullName') ?? ''),
					phone: String(form.get('phone') ?? ''),
					location: String(form.get('location') ?? '')
				}
			});
		}

		const { fullName, phone, location } = parsed.data;
		const { error } = await supabase
			.from('profiles')
			.update({ full_name: fullName, phone, location: location || null })
			.eq('id', user!.id);

		if (error) {
			// e.g. the phone unique constraint — surface a friendly message.
			const message =
				error.code === '23505'
					? 'That phone number is already in use.'
					: 'Could not save your changes. Please try again.';
			return fail(400, { section: 'profile', formError: message });
		}

		return { section: 'profile', success: true };
	},

	// ── Avatar upload: <uid>/avatar.<ext> with upsert, store the public URL ──────
	uploadAvatar: async ({ request, locals: { user, supabase } }) => {
		const form = await request.formData();
		const file = form.get('avatar');

		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { section: 'avatar', formError: 'Choose an image to upload.' });
		}
		if (!AVATAR_TYPES.includes(file.type as (typeof AVATAR_TYPES)[number])) {
			return fail(400, { section: 'avatar', formError: 'Use a JPEG, PNG, or WebP image.' });
		}
		if (file.size > AVATAR_MAX_BYTES) {
			return fail(400, { section: 'avatar', formError: 'Image must be 2 MB or smaller.' });
		}

		const ext = AVATAR_EXT[file.type];
		const path = `${user!.id}/avatar.${ext}`;

		const { error: uploadError } = await supabase.storage
			.from('avatars')
			.upload(path, file, { upsert: true, contentType: file.type });
		if (uploadError) {
			return fail(400, { section: 'avatar', formError: 'Upload failed. Please try again.' });
		}

		// Public bucket → build the public URL. Add a version query so the header/img
		// refreshes immediately when an avatar is replaced at the same path.
		const {
			data: { publicUrl }
		} = supabase.storage.from('avatars').getPublicUrl(path);
		const versioned = `${publicUrl}?v=${Date.now()}`;

		const { error: updateError } = await supabase
			.from('profiles')
			.update({ avatar_url: versioned })
			.eq('id', user!.id);
		if (updateError) {
			return fail(400, {
				section: 'avatar',
				formError: 'Saved the image but could not update your profile.'
			});
		}

		return { section: 'avatar', success: true };
	},

	// ── Change password (recent session required by Supabase) ───────────────────
	changePassword: async ({ request, locals: { supabase } }) => {
		const form = await request.formData();
		const parsed = resetPasswordSchema.safeParse({
			password: String(form.get('password') ?? ''),
			confirmPassword: String(form.get('confirmPassword') ?? '')
		});
		if (!parsed.success) {
			return fail(400, { section: 'password', errors: fieldErrors(parsed.error) });
		}

		const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
		if (error) {
			// Typically a stale session ("reauthentication needed"): steer to reset flow.
			return fail(400, {
				section: 'password',
				formError:
					'We could not change your password here — your session may be too old. Use "Forgot password?" to reset it by email.'
			});
		}

		return { section: 'password', success: true };
	}
};
