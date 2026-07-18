import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';

type CategoryRow = Database['public']['Tables']['categories']['Row'];

/** A category trimmed to the fields the UI needs. */
export type Category = Pick<CategoryRow, 'id' | 'name' | 'slug' | 'sort_order'>;

/** A top-level category with its ordered subcategories. */
export type CategoryTreeNode = Category & { children: Category[] };

/**
 * Load the category taxonomy as a two-level tree: top-level categories ordered by
 * sort_order, each with its subcategories (also ordered). One query, assembled in
 * memory (no N+1).
 *
 * Categories are public-read, admin-managed data, so the request's client (anon or
 * authenticated) is sufficient — no service role. Call this once per request (e.g.
 * from a layout load) and pass the result down to navigation, the listing form, and
 * the browse pages.
 */
export async function loadCategoryTree(
	supabase: SupabaseClient<Database>
): Promise<CategoryTreeNode[]> {
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
