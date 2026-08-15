import type { PageServerLoad } from './$types';

const LIVE = ['open', 'under_review'] as const;
const FILTERS = ['live', 'open', 'under_review', 'resolved', 'all'] as const;
type Filter = (typeof FILTERS)[number];

/**
 * The dispute queue. Default filter is `live` (open + under_review) per ADM-1's
 * state model — the two states where someone is waiting on a decision.
 *
 * Read through the SESSION client: disputes_select carries an `is_admin()` arm,
 * so RLS stays a second layer behind the /admin gate here.
 */
export const load: PageServerLoad = async ({ locals: { supabase }, url }) => {
	const raw = url.searchParams.get('status') ?? 'live';
	const filter: Filter = (FILTERS as readonly string[]).includes(raw) ? (raw as Filter) : 'live';

	let query = supabase
		.from('disputes')
		.select('id, order_id, opened_by, reason, status, created_at, resolved_at')
		.order('created_at', { ascending: false });

	if (filter === 'live') query = query.in('status', LIVE);
	else if (filter === 'resolved') query = query.like('status', 'resolved_%');
	else if (filter !== 'all') query = query.eq('status', filter);

	const { data: disputes } = await query;
	const rows = disputes ?? [];

	// Order + buyer context in two batched reads rather than per row. orders_select
	// and profiles_select both admit admins, so the session client reaches them.
	const orderIds = [...new Set(rows.map((d) => d.order_id))];
	const buyerIds = [...new Set(rows.map((d) => d.opened_by))];

	const [{ data: orders }, { data: buyers }] = await Promise.all([
		orderIds.length
			? supabase
					.from('orders')
					.select('id, amount_total, seller_net, status, listing_id, seller_id')
					.in('id', orderIds)
			: Promise.resolve({ data: [] as never[] }),
		buyerIds.length
			? supabase.from('profiles').select('id, full_name').in('id', buyerIds)
			: Promise.resolve({ data: [] as never[] })
	]);

	const orderById = new Map((orders ?? []).map((o) => [o.id, o]));
	const buyerById = new Map((buyers ?? []).map((p) => [p.id, p]));

	// Counts drive the filter chips and come from the same shape the chips filter,
	// so a chip can never disagree with the list it produces.
	const { data: allStatuses } = await supabase.from('disputes').select('status');
	const every = allStatuses ?? [];
	const counts = {
		live: every.filter((d) => (LIVE as readonly string[]).includes(d.status)).length,
		open: every.filter((d) => d.status === 'open').length,
		under_review: every.filter((d) => d.status === 'under_review').length,
		resolved: every.filter((d) => d.status.startsWith('resolved_')).length,
		all: every.length
	};

	return {
		filter,
		counts,
		disputes: rows.map((d) => {
			const order = orderById.get(d.order_id);
			return {
				id: d.id,
				status: d.status,
				reason: d.reason,
				createdAt: d.created_at,
				buyerName: buyerById.get(d.opened_by)?.full_name ?? 'Unknown buyer',
				// bigint KES cents (D8) — formatted at the edge, never in the payload.
				amountCents: order?.amount_total ?? null,
				orderStatus: order?.status ?? null
			};
		})
	};
};
