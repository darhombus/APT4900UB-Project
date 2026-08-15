import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/**
 * Live boosts, newest expiry last.
 *
 * Read through the SESSION client. BST-22 added an admin arm to boosts_select
 * (`seller_id = auth.uid() or public.is_admin()`), so RLS admits this read on
 * its own and stays a layer behind the /admin gate — a regression in the layout
 * still meets an RLS refusal rather than leaking the table. Before that arm this
 * had to use the service-role client, which would have leaked it.
 *
 * "Live" means the window is still open — `boosted_until > now()` is what
 * actually elevates a listing, not boosts.status, which the expiry job tidies
 * afterwards. Filtering on status alone would list boosts that stopped
 * elevating hours ago.
 */
export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const now = new Date().toISOString();

	const { data: rows } = await supabase
		.from('boosts')
		.select('id, listing_id, seller_id, duration_days, price_kes_charged, starts_at, expires_at')
		.eq('status', 'active')
		.gt('expires_at', now)
		.order('expires_at', { ascending: true })
		.limit(100);

	const boosts = rows ?? [];
	const listingIds = [...new Set(boosts.map((b) => b.listing_id))];
	const sellerIds = [...new Set(boosts.map((b) => b.seller_id))];

	const [{ data: listings }, { data: sellers }] = await Promise.all([
		listingIds.length
			? supabase.from('listings').select('id, title, status').in('id', listingIds)
			: Promise.resolve({ data: [] as { id: string; title: string; status: string }[] }),
		sellerIds.length
			? supabase.from('profiles').select('id, full_name').in('id', sellerIds)
			: Promise.resolve({ data: [] as { id: string; full_name: string | null }[] })
	]);

	const listingById = new Map((listings ?? []).map((l) => [l.id, l]));
	const nameById = new Map((sellers ?? []).map((s) => [s.id, s.full_name]));

	return {
		boosts: boosts.map((b) => ({
			id: b.id,
			listingId: b.listing_id,
			listingTitle: listingById.get(b.listing_id)?.title ?? 'Unknown listing',
			listingStatus: listingById.get(b.listing_id)?.status ?? null,
			sellerId: b.seller_id,
			sellerName: nameById.get(b.seller_id) ?? 'Unknown seller',
			durationDays: b.duration_days,
			priceKes: b.price_kes_charged,
			// Non-null in practice — the query filters `expires_at > now()`, which a
			// null can never satisfy — but the column is nullable (a pending boost has
			// no window yet), so narrow it here rather than asserting at the view.
			expiresAt: b.expires_at as string
		}))
	};
};

export const actions: Actions = {
	/**
	 * Ends the boost the way natural expiry does — the RPC moves expires_at and
	 * lets the sync trigger recompute listings.boosted_until. Nothing here needs
	 * to touch the listing.
	 */
	terminate: async ({ locals: { supabase }, request }) => {
		const form = await request.formData();
		const { error: err } = await supabase.rpc('admin_terminate_boost', {
			p_boost_id: String(form.get('boostId') ?? '')
		});
		if (err) {
			return fail(400, {
				actionError:
					err.code === '42501'
						? 'Your account cannot end boosts.'
						: 'That boost is no longer running. Reload to see the current list.'
			});
		}
		return { terminated: true };
	}
};
