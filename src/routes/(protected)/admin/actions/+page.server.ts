import type { PageServerLoad } from './$types';

/** The catalog, in the order Migration B declares it. */
const ACTION_TYPES = [
	'dispute_review',
	'dispute_resolve_refunded',
	'dispute_resolve_rejected',
	'listing_takedown',
	'listing_restore',
	'review_hide',
	'review_restore',
	'boost_terminate',
	'pii_read'
] as const;

/**
 * The audit log, newest first, filterable by action type.
 *
 * READ-ONLY BY CONSTRUCTION, not by convention: ADM-5 withholds UPDATE and
 * DELETE from every runtime role including service_role, so there is no write
 * path to offer here even if the page wanted one.
 *
 * Read through the SESSION client — admin_actions_select is `is_admin()`, so
 * RLS remains a second layer behind the /admin gate.
 */
export const load: PageServerLoad = async ({ locals: { supabase }, url }) => {
	const raw = url.searchParams.get('type') ?? 'all';
	const type = (ACTION_TYPES as readonly string[]).includes(raw) ? raw : 'all';

	let query = supabase
		.from('admin_actions')
		.select('id, actor_id, action_type, target_table, target_id, detail, created_at')
		.order('created_at', { ascending: false })
		.limit(200);
	if (type !== 'all') query = query.eq('action_type', type);

	const { data: rows } = await query;
	const actions = rows ?? [];

	const actorIds = [...new Set(actions.map((a) => a.actor_id))];
	const { data: actors } = actorIds.length
		? await supabase.from('profiles').select('id, full_name').in('id', actorIds)
		: { data: [] as { id: string; full_name: string | null }[] };
	const nameById = new Map((actors ?? []).map((a) => [a.id, a.full_name]));

	return {
		type,
		types: ACTION_TYPES,
		actions: actions.map((a) => ({
			id: a.id,
			actorName: nameById.get(a.actor_id) ?? 'Unknown admin',
			actionType: a.action_type,
			targetTable: a.target_table,
			targetId: a.target_id,
			detail: a.detail,
			createdAt: a.created_at
		}))
	};
};
