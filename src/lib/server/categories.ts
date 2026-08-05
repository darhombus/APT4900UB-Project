import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';

type CategoryRow = Database['public']['Tables']['categories']['Row'];

/** A category trimmed to the fields the UI needs. */
export type Category = Pick<CategoryRow, 'id' | 'name' | 'slug' | 'sort_order'>;

/** A top-level category with its ordered subcategories. */
export type CategoryTreeNode = Category & { children: Category[] };

/** How long a fetched tree is reused before the next call re-queries. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** The in-flight or last-resolved tree. Holding the PROMISE (not the value) is
 *  what dedupes concurrent callers: the layout and the page load run in
 *  parallel, so a value-only cache would still let both miss and both query. */
let cached: { promise: Promise<CategoryTreeNode[]>; at: number } | null = null;

/** Drop the cache — for tests, and for any future admin action that edits the
 *  taxonomy and wants the change visible before the TTL expires. */
export function invalidateCategoryTree(): void {
	cached = null;
}

/**
 * Load the category taxonomy as a two-level tree: top-level categories ordered by
 * sort_order, each with its subcategories (also ordered). One query, assembled in
 * memory (no N+1).
 *
 * Categories are public-read, admin-managed data, so the request's client (anon or
 * authenticated) is sufficient — no service role.
 *
 * CACHED per server instance, for 5 minutes. Both the root layout and the browse
 * pages need the tree, and they load in parallel — so every /search and /c/<slug>
 * request was issuing the same query twice, on top of the search RPC and the
 * cover-image fetch. On Vercel that is two extra round trips per navigation, which
 * is most of what made the sort pills and filter chips feel slow: the database side
 * of a search is ~5ms, while the page took ~1.5s.
 *
 * Safe to share across requests and users precisely because the data is neither
 * user-scoped nor RLS-varying — every caller, signed in or not, gets the same
 * public taxonomy. Never cache anything that differs per user this way. The cost is
 * that an admin's taxonomy edit can take up to the TTL to appear; call
 * `invalidateCategoryTree()` when that matters.
 */
export function loadCategoryTree(supabase: SupabaseClient<Database>): Promise<CategoryTreeNode[]> {
	const now = Date.now();
	if (cached && now - cached.at < CACHE_TTL_MS) return cached.promise;

	// Cache the promise immediately so a parallel caller joins this fetch rather
	// than starting its own; clear it on failure so an error is never cached.
	const promise = fetchCategoryTree(supabase).catch((err) => {
		cached = null;
		throw err;
	});
	cached = { promise, at: now };
	return promise;
}

async function fetchCategoryTree(supabase: SupabaseClient<Database>): Promise<CategoryTreeNode[]> {
	const { data, error } = await supabase
		.from('categories')
		.select('id, name, slug, parent_id, sort_order')
		.order('sort_order', { ascending: true });

	if (error) throw error;
	const rows = data ?? [];

	const toCategory = (r: (typeof rows)[number]): Category => ({
		id: r.id,
		name: r.name,
		slug: r.slug,
		sort_order: r.sort_order
	});

	// Filtering a globally sort_order-ordered list preserves each parent's child
	// order (1..6) and the top-level order (1..4).
	return rows
		.filter((r) => r.parent_id === null)
		.map((top) => ({
			...toCategory(top),
			children: rows.filter((r) => r.parent_id === top.id).map(toCategory)
		}));
}
