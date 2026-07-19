import { CONDITIONS, type CategoryTree, type ConditionValue } from '$lib/validation/listings';

/**
 * Pure search query composition — parses the URL params into a normalized shape
 * and composes the arguments for the `search_listings` RPC (including subtree
 * expansion of a category slug). No Supabase client, no `$env`, so it's fully
 * unit-testable; the server module (`$lib/server/search.ts`) executes the result.
 */

export const SEARCH_PAGE_SIZE = 24;

/** Upper bound on search tokens — a defensive cap so a pathological query can't
 *  expand into an unbounded AND of ILIKEs. Mirrored by the slot count in the
 *  `search_listings` RPC (extra tokens beyond this are dropped here, never sent). */
export const MAX_SEARCH_TOKENS = 6;

export type SearchSort = 'relevance' | 'newest' | 'price_asc' | 'price_desc';
export const SEARCH_SORTS: readonly SearchSort[] = [
	'relevance',
	'newest',
	'price_asc',
	'price_desc'
];

const CONDITION_VALUES = new Set<string>(CONDITIONS.map((c) => c.value));

/** Normalized, validated search state — the single source of truth for the page. */
export interface SearchParams {
	q: string;
	category: string; // slug, or '' for any
	minPrice: number | null;
	maxPrice: number | null;
	condition: ConditionValue[];
	sort: SearchSort;
	page: number;
}

/** The composed RPC arguments + pagination window (the "query description"). */
export interface SearchQuery {
	args: {
		q: string[]; // LIKE-escaped tokens, AND-matched; [] means no text filter
		category_ids: string[] | null; // subtree-expanded; [] = a real but unknown slug
		min_price: number | null;
		max_price: number | null;
		conditions: ConditionValue[] | null;
		sort: SearchSort;
	};
	from: number;
	to: number;
	page: number;
	/** True when a query is present and relevance ranking applies. */
	ranked: boolean;
}

function toPositiveInt(value: string | null): number | null {
	if (value === null) return null;
	const cleaned = value.replace(/[,\s]/g, '');
	if (!/^\d+$/.test(cleaned)) return null;
	const n = Number(cleaned);
	return n > 0 ? n : null;
}

/** Escape LIKE/ILIKE wildcards so a user's `%` or `_` is matched literally. */
export function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Split a query into LIKE-escaped substring tokens for AND matching: whitespace
 *  splits words, empty tokens are dropped, the count is capped, and each surviving
 *  token is wildcard-escaped. Returns [] for a blank query (→ no text filter). */
export function tokenizeQuery(q: string): string[] {
	return q
		.split(/\s+/)
		.filter((t) => t.length > 0)
		.slice(0, MAX_SEARCH_TOKENS)
		.map(escapeLike);
}

/** All leaf category ids a slug covers: a subtree for a top-level slug, itself for
 *  a subcategory, or [] when the slug matches nothing (→ no results). */
export function resolveCategoryIds(tree: CategoryTree[], slug: string): string[] {
	const top = tree.find((t) => t.slug === slug);
	if (top) return top.children.map((c) => c.id);
	for (const t of tree) {
		const sub = t.children.find((c) => c.slug === slug);
		if (sub) return [sub.id];
	}
	return [];
}

export function parseSearchParams(sp: URLSearchParams): SearchParams {
	const q = (sp.get('q') ?? '').trim();
	const category = (sp.get('category') ?? '').trim();
	const condition = [...new Set(sp.getAll('condition'))].filter((c) =>
		CONDITION_VALUES.has(c)
	) as ConditionValue[];
	const page = Math.max(1, Math.floor(Number(sp.get('page')) || 1));

	const sortRaw = sp.get('sort') ?? '';
	let sort: SearchSort = SEARCH_SORTS.includes(sortRaw as SearchSort)
		? (sortRaw as SearchSort)
		: q
			? 'relevance'
			: 'newest';
	// Relevance is only meaningful with a query.
	if (sort === 'relevance' && !q) sort = 'newest';

	return {
		q,
		category,
		minPrice: toPositiveInt(sp.get('min_price')),
		maxPrice: toPositiveInt(sp.get('max_price')),
		condition,
		sort,
		page
	};
}

export function composeSearch(params: SearchParams, tree: CategoryTree[]): SearchQuery {
	const from = (params.page - 1) * SEARCH_PAGE_SIZE;
	const tokens = tokenizeQuery(params.q);
	return {
		args: {
			q: tokens,
			category_ids: params.category ? resolveCategoryIds(tree, params.category) : null,
			min_price: params.minPrice,
			max_price: params.maxPrice,
			conditions: params.condition.length ? params.condition : null,
			sort: params.sort
		},
		from,
		to: from + SEARCH_PAGE_SIZE - 1,
		page: params.page,
		ranked: tokens.length > 0 && params.sort === 'relevance'
	};
}
