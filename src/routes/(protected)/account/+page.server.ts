import type { PageServerLoad } from './$types';

// Auth is guaranteed by the (protected) group layout; email + role come from it.
// Here we just load the extra profile fields this page displays.
export const load: PageServerLoad = async ({ locals: { user, supabase } }) => {
	const { data: profile } = await supabase
		.from('profiles')
		.select('full_name, phone')
		.eq('id', user!.id)
		.single();

	return { profile };
};
