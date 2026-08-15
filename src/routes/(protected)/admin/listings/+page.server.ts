import { fail } from '@sveltejs/kit';
import { emitListingRemoved } from '$lib/server/notification-events';
import type { Actions, PageServerLoad } from './$types';

const FILTERS = ['all', 'active', 'removed', 'deleted'] as const;
type Filter = (typeof FILTERS)[number];

/**
 * Listing moderation.
 *
 * ADM-4/ADM-10: `removed` and `deleted` are held apart everywhere, because they
 * have different provenance — `removed` is an admin takedown and is restorable
 * here; `deleted` is the seller deleting their own listing and is none of an
 * admin's business. Collapsing them into "gone" would invite an admin to
 * "restore" something no admin ever took down.
 *
 * Read through the SESSION client: listings_select carries an `is_admin()` arm.
 */
export const load: PageServerLoad = async ({ locals: { supabase }, url }) => {
	const raw = url.searchParams.get('status') ?? 'all';
	const filter: Filter = (FILTERS as readonly string[]).includes(raw) ? (raw as Filter) : 'all';
	const q = (url.searchParams.get('q') ?? '').trim();

	let query = supabase
		.from('listings')
		.select('id, title, status, price, seller_id, created_at, removed_prior_status')
		.order('created_at', { ascending: false })
		.limit(100);

	if (filter !== 'all') query = query.eq('status', filter);
	// Title search only — an admin arriving here has a listing in mind, usually
	// from a report, and knows what it is called.
	if (q) query = query.ilike('title', `%${q}%`);

	const { data: rows } = await query;
	const listings = rows ?? [];

	const sellerIds = [...new Set(listings.map((l) => l.seller_id))];
	const { data: sellers } = sellerIds.length
		? await supabase.from('profiles').select('id, full_name').in('id', sellerIds)
		: { data: [] as { id: string; full_name: string | null }[] };
	const nameById = new Map((sellers ?? []).map((s) => [s.id, s.full_name]));

	return {
		filter,
		q,
		listings: listings.map((l) => ({
			id: l.id,
			title: l.title,
			status: l.status,
			price: l.price,
			sellerId: l.seller_id,
			sellerName: nameById.get(l.seller_id) ?? 'Unknown seller',
			priorStatus: l.removed_prior_status
		}))
	};
};

export const actions: Actions = {
	/**
	 * ADM-13 EMISSION LIVES HERE, not in the RPC.
	 *
	 * The database has no outbound HTTP, so admin_set_listing_visibility performs
	 * the mutation, writes its audit row, and RETURNS (seller_id, prior_status,
	 * admin_action_id, note). This action takes that return value and sends the
	 * event. The dedupe key is the admin_actions row id (ADM-13b): a listing id
	 * would silently discard the second takedown of the same listing.
	 */
	takedown: async ({ locals: { supabase }, request }) => {
		const form = await request.formData();
		const listingId = String(form.get('listingId') ?? '');
		const note = String(form.get('note') ?? '').trim();

		const { data, error: err } = await supabase.rpc('admin_set_listing_visibility', {
			p_listing_id: listingId,
			p_action: 'takedown',
			p_note: note || undefined
		});

		if (err) return fail(400, { actionError: refusalMessage(err.code, 'takedown') });

		// `returns table(...)` arrives as an array of one row.
		const result = Array.isArray(data) ? data[0] : data;
		if (result?.admin_action_id) {
			await emitListingRemoved(listingId, result.admin_action_id);
		}

		return { tookDown: true };
	},

	/** Restore emits nothing (ADM-13): the listing reappears at its prior status. */
	restore: async ({ locals: { supabase }, request }) => {
		const form = await request.formData();
		const listingId = String(form.get('listingId') ?? '');

		const { error: err } = await supabase.rpc('admin_set_listing_visibility', {
			p_listing_id: listingId,
			p_action: 'restore',
			p_note: undefined
		});

		if (err) return fail(400, { actionError: refusalMessage(err.code, 'restore') });
		return { restored: true };
	}
};

function refusalMessage(code: string | undefined, verb: 'takedown' | 'restore'): string {
	if (code === '42501') return 'Your account cannot moderate listings.';
	if (code === 'P0002') return 'That listing no longer exists.';
	return verb === 'takedown'
		? 'That listing is already taken down. Reload to see its current state.'
		: 'That listing cannot be restored — it was not taken down by an admin, or there is no recorded status to return it to.';
}
