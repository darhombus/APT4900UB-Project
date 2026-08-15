import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const FILTERS = ['all', 'visible', 'hidden'] as const;
type Filter = (typeof FILTERS)[number];

/**
 * Review moderation (ADM-4), on the existing ('visible','hidden') enum.
 *
 * Read through the SESSION client. BST-22 added an admin arm to reviews_select,
 * so an admin now reaches hidden reviews under RLS — which is exactly the set
 * this surface must see in order to restore one. Before that arm this had to use
 * the service-role client, putting the whole table behind the layout gate alone.
 *
 * The author carve-out is untouched: `buyer_id = auth.uid()` still lets a review's
 * author see it after moderation hides it.
 *
 * Writes still go through the RPC. SECURITY DEFINER is load-bearing there:
 * `authenticated` holds no UPDATE grant on reviews at all.
 */
export const load: PageServerLoad = async ({ locals: { supabase }, url }) => {
	const raw = url.searchParams.get('status') ?? 'all';
	const filter: Filter = (FILTERS as readonly string[]).includes(raw) ? (raw as Filter) : 'all';

	let query = supabase
		.from('reviews')
		.select('id, rating, body, status, created_at, seller_id, buyer_id, listing_id')
		.order('created_at', { ascending: false })
		.limit(100);
	if (filter !== 'all') query = query.eq('status', filter);

	const { data: rows } = await query;
	const reviews = rows ?? [];

	const personIds = [...new Set(reviews.flatMap((r) => [r.seller_id, r.buyer_id]))];
	const listingIds = [...new Set(reviews.map((r) => r.listing_id))];

	const [{ data: people }, { data: listings }] = await Promise.all([
		personIds.length
			? supabase.from('profiles').select('id, full_name').in('id', personIds)
			: Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
		listingIds.length
			? supabase.from('listings').select('id, title').in('id', listingIds)
			: Promise.resolve({ data: [] as { id: string; title: string }[] })
	]);

	const nameById = new Map((people ?? []).map((p) => [p.id, p.full_name]));
	const titleById = new Map((listings ?? []).map((l) => [l.id, l.title]));

	return {
		filter,
		reviews: reviews.map((r) => ({
			id: r.id,
			rating: r.rating,
			body: r.body,
			status: r.status,
			createdAt: r.created_at,
			buyerName: nameById.get(r.buyer_id) ?? 'Unknown buyer',
			sellerName: nameById.get(r.seller_id) ?? 'Unknown seller',
			sellerId: r.seller_id,
			listingTitle: titleById.get(r.listing_id) ?? 'Unknown listing'
		}))
	};
};

export const actions: Actions = {
	hide: async ({ locals: { supabase }, request }) => {
		const form = await request.formData();
		const { error: err } = await supabase.rpc('admin_set_review_status', {
			p_review_id: String(form.get('reviewId') ?? ''),
			p_action: 'hide'
		});
		if (err) return fail(400, { actionError: refusalMessage(err.code, 'hide') });
		return { hidden: true };
	},

	restore: async ({ locals: { supabase }, request }) => {
		const form = await request.formData();
		const { error: err } = await supabase.rpc('admin_set_review_status', {
			p_review_id: String(form.get('reviewId') ?? ''),
			p_action: 'restore'
		});
		if (err) return fail(400, { actionError: refusalMessage(err.code, 'restore') });
		return { restored: true };
	}
};

function refusalMessage(code: string | undefined, verb: 'hide' | 'restore'): string {
	if (code === '42501') return 'Your account cannot moderate reviews.';
	return verb === 'hide'
		? 'That review is already hidden. Reload to see its current state.'
		: 'That review is already visible. Reload to see its current state.';
}
