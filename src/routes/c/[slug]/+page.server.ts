import { error } from '@sveltejs/kit';
import { loadCategoryTree } from '$lib/server/categories';
import { parseSearchParams, SEARCH_PAGE_SIZE, type SearchQuery } from '$lib/search';
import { runSearch } from '$lib/server/search';
import { subcategoryNameMap } from '$lib/validation/listings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const tree = await loadCategoryTree(supabase);

	// Resolve the slug to a top-level category or a subcategory.
	let top = tree.find((t) => t.slug === params.slug) ?? null;
	let sub: { id: string; name: string; slug: string } | null = null;
	if (!top) {
		for (const t of tree) {
			const child = t.children.find((c) => c.slug === params.slug);
			if (child) {
				top = t;
				sub = child;
				break;
			}
		}
	}
	if (!top) error(404, 'Category not found');

	const isTop = sub === null;
	// Top-level: listings across the whole subtree; subcategory: just its own.
	const categoryIds = isTop ? top.children.map((c) => c.id) : [sub!.id];

	// A category page is a search pre-scoped to the path's category with no text
	// query, so it runs through the SAME executor as /search — the sort pills and
	// price/condition filters behave identically (Section 8). `parseSearchParams`
	// yields sort/price/condition/page from the URL (never `relevance`, since there
	// is no query); the category comes from the path, not `?category=`.
	const sp = parseSearchParams(url.searchParams);
	const from = (sp.page - 1) * SEARCH_PAGE_SIZE;
	const query: SearchQuery = {
		args: {
			q: [],
			category_ids: categoryIds,
			min_price: sp.minPrice,
			max_price: sp.maxPrice,
			conditions: sp.condition.length ? sp.condition : null,
			location: sp.location || null,
			sort: sp.sort
		},
		from,
		to: from + SEARCH_PAGE_SIZE - 1,
		page: sp.page,
		ranked: false,
		// A category page carries no text query at all (`q: []` above), so the
		// short-query guard can never apply to it.
		tooShort: false
	};
	const { listings, total } = await runSearch(supabase, query, subcategoryNameMap(tree));

	return {
		heading: isTop ? top.name : sub!.name,
		slug: params.slug,
		parent: isTop ? null : { name: top.name, slug: top.slug },
		subcategories: isTop ? top.children.map((c) => ({ name: c.name, slug: c.slug })) : [],
		listings,
		page: sp.page,
		total,
		totalPages: Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE)),
		sort: sp.sort,
		minPrice: sp.minPrice,
		maxPrice: sp.maxPrice,
		condition: sp.condition,
		location: sp.location
	};
};
