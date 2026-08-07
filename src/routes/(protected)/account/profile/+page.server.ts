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
//
// Two reads since the PII split: the public columns from `profiles`, the private
// ones from `profiles_private` through the caller's OWN client — own-row RLS is
// what authorizes it, so no service role and no security-definer function is
// involved. `maybeSingle` because absence of a private row is a valid state (D3),
// not an error: a user who signed up without a phone has never had one, and the
// upsert below is what creates it the first time they save.
//
// The page keeps consuming one flat `profile` object, so the split stops here
// rather than spreading into the markup.
export const load: PageServerLoad = async ({ locals: { user, supabase } }) => {
	const [{ data: profile }, { data: private_ }] = await Promise.all([
		supabase.from('profiles').select('full_name, avatar_url, role').eq('id', user!.id).single(),
		supabase.from('profiles_private').select('phone, location').eq('id', user!.id).maybeSingle()
	]);

	return {
		profile: profile
			? {
					...profile,
					phone: private_?.phone ?? null,
					location: private_?.location ?? null
				}
			: null,
		email: user!.email
	};
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

		// e.g. the phone unique constraint — surface a friendly message.
		const saveFailed = (code?: string) =>
			fail(400, {
				section: 'profile',
				formError:
					code === '23505'
						? 'That phone number is already in use.'
						: 'Could not save your changes. Please try again.'
			});

		// Two writes since the PII split, public half first: if that fails there is
		// no reason to touch the private row.
		const { error: publicError } = await supabase
			.from('profiles')
			.update({ full_name: fullName })
			.eq('id', user!.id);
		if (publicError) return saveFailed(publicError.code);

		// UPSERT (D7): one path for a user who has never had a private row and one
		// who is editing an existing one. `id` is supplied explicitly because it is
		// both the primary key and the RLS predicate — the own-row INSERT policy
		// checks it, so a caller cannot upsert a row onto anyone else.
		const { error: privateError } = await supabase
			.from('profiles_private')
			.upsert({ id: user!.id, phone, location: location || null }, { onConflict: 'id' });
		if (privateError) return saveFailed(privateError.code);

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
