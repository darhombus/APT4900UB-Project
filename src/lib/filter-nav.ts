import type { SearchParams, SearchSort } from '$lib/search';
import { SEARCH_SORTS } from '$lib/search';

/**
 * Shared, pure URL/sort logic for the results controls (sort pills + filters)
 * used identically on `/search` and the category pages. Filters are navigation,
 * not client state — every control resolves to a URL, and this module builds
 * those URLs the same way regardless of which page renders the bar.
 *
 * The only difference between the two pages is the base path and which of `q` /
 * `category` are ever set: `/search` carries both, a category page carries
 * neither (its category lives in the path). `buildFilterUrl` emits a param only
 * when it's non-default, so the same call produces `/search?...` or
 * `/c/<slug>?...` correctly with no per-page branching.
 */

/** Default sort for a given state: relevance when a text query is present, else newest. */
export function defaultSort(hasQuery: boolean): SearchSort {
	return hasQuery ? 'relevance' : 'newest';
}

/** Build a results URL for `base`, merging `patch` over `current` and omitting
 *  every default/empty value so links stay clean and shareable. */
export function buildFilterUrl(
	base: string,
	current: SearchParams,
	patch: Partial<SearchParams> = {}
): string {
	const next: SearchParams = { ...current, ...patch };
	const enc = encodeURIComponent;
	const parts: string[] = [];
	if (next.q) parts.push(`q=${enc(next.q)}`);
	if (next.category) parts.push(`category=${enc(next.category)}`);
	if (next.minPrice !== null) parts.push(`min_price=${next.minPrice}`);
	if (next.maxPrice !== null) parts.push(`max_price=${next.maxPrice}`);
	for (const c of next.condition) parts.push(`condition=${c}`);
	if (next.location) parts.push(`location=${enc(next.location)}`);
	if (next.sort !== defaultSort(next.q !== '')) parts.push(`sort=${next.sort}`);
	if (next.page > 1) parts.push(`page=${next.page}`);
	return parts.length ? `${base}?${parts.join('&')}` : base;
}

export interface PricePill {
	/** Whether a price sort is currently in effect. */
	active: boolean;
	/** Arrow to show while active; null when inactive. */
	direction: 'asc' | 'desc' | null;
	/** Where clicking the pill navigates: activate ascending, then flip the direction. */
	nextSort: SearchSort;
	/** Visible label, doubling as the accessible name. */
	label: string;
}

/** The single Price pill's view + toggle target for a given sort (decision D2):
 *  inactive → "Price" (click = ascending); ascending → "Price: Low to High"
 *  (click = descending); descending → "Price: High to Low" (click = ascending). */
export function pricePillState(sort: SearchSort): PricePill {
	if (sort === 'price_asc')
		return { active: true, direction: 'asc', nextSort: 'price_desc', label: 'Price: Low to High' };
	if (sort === 'price_desc')
		return { active: true, direction: 'desc', nextSort: 'price_asc', label: 'Price: High to Low' };
	return { active: false, direction: null, nextSort: 'price_asc', label: 'Price' };
}

/** Read the effective sort from a URL's params (for optimistic, click-time pill
 *  state), applying the same relevance-needs-a-query rule as the server parser. */
export function sortFromParams(sp: URLSearchParams, hasQuery: boolean): SearchSort {
	const raw = sp.get('sort') ?? '';
	if ((SEARCH_SORTS as readonly string[]).includes(raw)) {
		if (raw === 'relevance' && !hasQuery) return 'newest';
		return raw as SearchSort;
	}
	return defaultSort(hasQuery);
}
