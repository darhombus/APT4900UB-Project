import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ locals: { supabase } }) => {
		// The become_seller() RPC (Section 3) is the ONLY sanctioned buyer -> seller
		// transition — it upgrades the caller's own row server-side and no-ops any
		// other transition. Direct role UPDATEs are blocked by RLS.
		const { error } = await supabase.rpc('become_seller');
		if (error) {
			return fail(500, { error: 'Could not upgrade your account. Please try again.' });
		}

		redirect(303, '/sell');
	}
};
