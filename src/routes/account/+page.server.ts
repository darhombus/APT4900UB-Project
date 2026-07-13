import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Minimal placeholder landing so the auth loop has somewhere to land. Section 6
// relocates /account into the (protected) route group with a shared guard layout;
// the inline check here is temporary.
export const load: PageServerLoad = async ({ locals: { session, user, supabase } }) => {
	if (!session || !user) redirect(303, '/login?redirectTo=/account');

	const { data: profile } = await supabase
		.from('profiles')
		.select('full_name, phone, role')
		.eq('id', user.id)
		.single();

	return { email: user.email, profile };
};
