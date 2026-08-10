import { json } from '@sveltejs/kit';
import { createSupabaseAdmin } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

/**
 * Health probe. Two independent checks, because they fail for different reasons
 * and only one of them was ever covered.
 *
 * `db`    — a trivial select on `categories` through the REQUEST-SCOPED ANON
 *           client. Answers "is the database reachable and migrated at all".
 *
 *           NB: use a real SELECT, not `{ head: true, count: 'exact' }`. A
 *           head/count query issues an HTTP HEAD, and against a *missing* table
 *           supabase-js gets a 204 with no error — which would falsely report
 *           db:true. A GET select returns the PGRST205 "table not found" error,
 *           so an unmigrated database correctly reports db:false.
 *
 * `admin` — the same question for the SERVICE-ROLE credential, which the anon
 *           check cannot see. Added 2026-08-11.
 *
 * WHY `admin` EXISTS. On 2026-08-10 production ran for hours with
 * `SUPABASE_SERVICE_ROLE_KEY` set to the literal string `[SENSITIVE]` (see the
 * comment in .github/workflows/migrate.yml). Every admin query 401'd, no payment
 * could be initialised, and NOTHING SURFACED IT: deploys were green, pages
 * returned 200, and this very endpoint reported healthy — because `db` uses the
 * anon client, which was fine the whole time. It was found by reading Supabase's
 * API logs by hand.
 *
 * THE STATUS CODE IS THE POINT. Previously this always returned 200 and put the
 * outcome in the body, so an automated caller had to parse JSON to learn
 * anything. It now returns 503 when either check fails, which is what lets CI
 * gate a deploy on it with a plain `curl`.
 *
 * WHAT IT DELIBERATELY DOES NOT SAY. Booleans only — no error text, no key
 * fragment, no table names. Detail goes to the server log where an operator can
 * read it. This endpoint is public and unauthenticated (CI has no session), so
 * it must reveal nothing beyond "this deployment can or cannot talk to its
 * database".
 */

// Never prerendered, never cached: a cached 200 would report the health of some
// earlier deployment, which is worse than no check at all.
export const prerender = false;

export const GET: RequestHandler = async ({ locals: { supabase }, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });

	const { error: dbError } = await supabase.from('categories').select('id').limit(1);

	// `boost_packages` is the cheapest meaningful service-role read in the schema:
	// three rows, primary-key scan, and — crucially — `anon` holds NO grant on it.
	// A request that somehow authenticated as anon rather than service_role fails
	// here too, rather than quietly succeeding and reporting false health.
	const { error: adminError } = await createSupabaseAdmin()
		.from('boost_packages')
		.select('id')
		.limit(1);

	if (dbError) console.error('[health] anon read failed: %s (%s)', dbError.message, dbError.code);
	if (adminError) {
		console.error(
			'[health] service-role read failed: %s (%s)',
			adminError.message,
			adminError.code
		);
	}

	const db = !dbError;
	const admin = !adminError;
	const ok = db && admin;

	return json({ ok, db, admin }, { status: ok ? 200 : 503 });
};
