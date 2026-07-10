import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Health probe. `db` reflects whether a trivial query against the database
 * (a count on categories via the request-scoped anon client) succeeds.
 */
export const GET: RequestHandler = async ({ locals: { supabase } }) => {
	const { error } = await supabase.from('categories').select('*', { count: 'exact', head: true });

	return json({ ok: true, db: !error });
};
