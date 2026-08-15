import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/**
 * One person, as an admin needs to see them.
 *
 * ONE CLIENT. profiles, listings, orders and disputes all admit admins through
 * their own RLS, so the session client reads all four and RLS stays a layer
 * behind the /admin gate rather than being bypassed by service_role.
 *
 * These are COUNTS, and RLS filters a count exactly as it filters rows — an
 * unreachable table reports 0, not an error. That is why the admin arms are the
 * thing being relied on here and not the gate.
 *
 * THE PRIVATE DETAILS ARE NOT LOADED HERE, DELIBERATELY. The load renders the
 * public profile only; phone and location arrive solely through the `reveal`
 * action, which calls admin_read_private_profile and writes a `pii_read` audit
 * row on every call. Loading them here would make every page view a silent PII
 * access and would make the audit log a record of navigation rather than of
 * looking — a deliberate click is the thing worth recording.
 */
export const load: PageServerLoad = async ({ locals: { supabase }, params }) => {
	const { data: profile } = await supabase
		.from('profiles')
		.select('id, full_name, avatar_url, role, created_at, review_count, rating_sum')
		.eq('id', params.id)
		.maybeSingle();

	if (!profile) error(404, 'Not found');

	// Activity summary. Counts only — the detail lives on the surfaces that own it.
	const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
	const [listings, ordersAsBuyer, ordersAsSeller, disputesOpened] = await Promise.all([
		count(
			supabase
				.from('listings')
				.select('id', { count: 'exact', head: true })
				.eq('seller_id', params.id)
		),
		count(
			supabase.from('orders').select('id', { count: 'exact', head: true }).eq('buyer_id', params.id)
		),
		count(
			supabase
				.from('orders')
				.select('id', { count: 'exact', head: true })
				.eq('seller_id', params.id)
		),
		count(
			supabase
				.from('disputes')
				.select('id', { count: 'exact', head: true })
				.eq('opened_by', params.id)
		)
	]);

	return {
		profile,
		activity: { listings, ordersAsBuyer, ordersAsSeller, disputesOpened }
	};
};

export const actions: Actions = {
	/**
	 * Every reveal is a logged pii_read (ADM-5). The RPC writes its audit row
	 * BEFORE the read, so an admin cannot obtain the data and leave no trace.
	 */
	reveal: async ({ locals: { supabase }, params }) => {
		const { data, error: err } = await supabase.rpc('admin_read_private_profile', {
			p_profile_id: params.id
		});

		if (err) {
			return fail(400, {
				revealError:
					err.code === '42501'
						? 'Your account cannot view private details.'
						: 'Could not load private details.'
			});
		}

		// `returns table(...)` arrives as an array; an empty one is a legitimate
		// state (PII D3 — a person who never saved a phone number has no row).
		const row = Array.isArray(data) ? data[0] : data;
		return {
			revealed: true,
			phone: row?.phone ?? null,
			location: row?.location ?? null
		};
	}
};
