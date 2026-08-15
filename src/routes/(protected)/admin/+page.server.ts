import type { PageServerLoad } from './$types';

/**
 * The overview is a set of queue depths — what is waiting, not what happened.
 *
 * ONE CLIENT. Every table counted here admits admins through its own RLS
 * (`... or is_admin()`), so the session client reads all of them and RLS stays a
 * layer behind the /admin gate: a regression in the layout still meets an RLS
 * refusal rather than leaking a table.
 *
 * boosts and reviews were the two exceptions until BST-22 added their admin
 * arms; before that they had to be counted with the service-role client.
 */
export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;

	const [openDisputes, removedListings, hiddenReviews, activeBoosts, recentActions] =
		await Promise.all([
			count(
				supabase
					.from('disputes')
					.select('id', { count: 'exact', head: true })
					.in('status', ['open', 'under_review'])
			),
			count(
				supabase
					.from('listings')
					.select('id', { count: 'exact', head: true })
					.eq('status', 'removed')
			),
			count(
				supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('status', 'hidden')
			),
			count(
				supabase
					.from('boosts')
					.select('id', { count: 'exact', head: true })
					.eq('status', 'active')
					.gt('expires_at', new Date().toISOString())
			),
			count(supabase.from('admin_actions').select('id', { count: 'exact', head: true }))
		]);

	return { openDisputes, removedListings, hiddenReviews, activeBoosts, recentActions };
};
