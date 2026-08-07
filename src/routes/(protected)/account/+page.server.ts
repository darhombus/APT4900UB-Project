import type { PageServerLoad } from './$types';

// Auth is guaranteed by the (protected) group layout; email + role come from it.
// Here we just load the extra profile fields this page displays.
//
// Two tables since the PII split: `phone` lives in `profiles_private`, reachable
// only through the caller's own client and only for their own row. `maybeSingle`
// rather than `single` because having no private row is a valid state (D3) — a
// user who signed up without a phone simply has none.
export const load: PageServerLoad = async ({ locals: { user, supabase } }) => {
	const [{ data: profile }, { data: private_ }] = await Promise.all([
		supabase.from('profiles').select('full_name').eq('id', user!.id).single(),
		supabase.from('profiles_private').select('phone').eq('id', user!.id).maybeSingle()
	]);

	return { profile: profile ? { ...profile, phone: private_?.phone ?? null } : null };
};
