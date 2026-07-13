import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

// Logout is POST-only (a form action in the header). A stray GET just bounces home.
export const load: PageServerLoad = async () => {
	redirect(303, '/');
};

export const actions: Actions = {
	default: async ({ locals: { supabase } }) => {
		await supabase.auth.signOut();
		redirect(303, '/');
	}
};
