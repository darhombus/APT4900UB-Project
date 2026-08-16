import { loadCategoryTree } from '$lib/server/categories';
import { parseSearchParams, composeSearch, SEARCH_PAGE_SIZE } from '$lib/search';
import { runSearch } from '$lib/server/search';
import { subcategoryNameMap, type CategoryTree } from '$lib/validation/listings';
import type { PageServerLoad } from './$types';

function categoryName(tree: CategoryTree[], slug: string): string | null {
	const top = tree.find((t) => t.slug === slug);
	if (top) return top.name;
	for (const t of tree) {
		const sub = t.children.find((c) => c.slug === slug);
		if (sub) return sub.name;
	}
	return null;
}

export const load: PageServerLoad = async ({ url, locals: { supabase } }) => {
	const tree = await loadCategoryTree(supabase);
	const params = parseSearchParams(url.searchParams);
	const query = composeSearch(params, tree);

	// A one-character query never reaches the database. The guard lives here as
	// well as in the page because /search is reachable directly — a bookmark, a
	// pasted link, the back button — and because the search box is a native GET
	// form that submits with JavaScript off. A guard only in the component would
	// be bypassed by every one of those, and would still pay for the round trip.
	const { listings, total } = query.tooShort
		? { listings: [], total: 0 }
		: await runSearch(supabase, query, subcategoryNameMap(tree));

	return {
		params,
		tooShort: query.tooShort,
		listings,
		total,
		totalPages: Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE)),
		categoryTree: tree.map((t) => ({
			name: t.name,
			slug: t.slug,
			children: t.children.map((c) => ({ name: c.name, slug: c.slug }))
		})),
		categoryName: params.category ? categoryName(tree, params.category) : null
	};
};
