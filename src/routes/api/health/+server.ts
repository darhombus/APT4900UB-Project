import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Health probe. `db` reflects whether a trivial query against the database
 * (a select on categories via the request-scoped anon client) succeeds.
 *
 * NB: use a real SELECT, not `{ head: true, count: 'exact' }`. A head/count
 * query issues an HTTP HEAD, and against a *missing* table supabase-js gets a
 * 204 with no error — which would falsely report db:true. A GET select returns
 * the PGRST205 "table not found" error, so an unmigrated database correctly
 * reports db:false.
 */
export const GET: RequestHandler = async ({ locals: { supabase } }) => {
	const { error } = await supabase.from('categories').select('id').limit(1);

	return json({ ok: true, db: !error });
};
