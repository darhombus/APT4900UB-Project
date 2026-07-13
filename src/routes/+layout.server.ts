import type { LayoutServerLoad } from './$types';

/**
 * Runs on the server for every route. `locals.session` is already the validated
 * session (the `auth` handle resolved it via getUser once for this request), so we
 * pass it straight down and forward cookies that +layout.ts uses to seed the
 * browser/server clients. For signed-in users we also fetch the header essentials
 * (avatar + name) so the nav can show the avatar with an initials fallback.
 */
export const load: LayoutServerLoad = async ({ locals: { session, user, supabase }, cookies }) => {
	let profile: { full_name: string; avatar_url: string | null } | null = null;
	if (session && user) {
		const { data } = await supabase
			.from('profiles')
			.select('full_name, avatar_url')
			.eq('id', user.id)
			.single();
		profile = data;
	}

	return {
		session,
		profile,
		cookies: cookies.getAll()
	};
};
