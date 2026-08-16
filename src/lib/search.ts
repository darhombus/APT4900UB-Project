import {
	CONDITIONS,
	NAIROBI_AREAS,
	type CategoryTree,
	type ConditionValue
} from '$lib/validation/listings';

/**
 * Pure search query composition — parses the URL params into a normalized shape
 * and composes the arguments for the `search_listings` RPC (including subtree
 * expansion of a category slug). No Supabase client, no `$env`, so it's fully
 * unit-testable; the server module (`$lib/server/search.ts`) executes the result.
 */

export const SEARCH_PAGE_SIZE = 24;

/** Upper bound on search tokens — a defensive cap so a pathological query can't
 *  expand into an unbounded AND of tsquery terms (each token can itself expand
 *  into a disjunction, so the cap matters more than the token count suggests).
 *  Extra tokens beyond this are dropped here and never sent. */
export const MAX_SEARCH_TOKENS = 6;

/**
 * The shortest query we will actually run. TWO, and the exact value is the whole
 * point — it is not a round number picked for comfort.
 *
 * Measured against `search_listings` on the real catalog, a search matches on
 * one of two mechanisms, and NEITHER is predicted by length:
 *
 *   full-text   `:*` is LEXEME-INITIAL, so 'iph' finds "iPhone" and 'ph' cannot.
 *   trigram     pg_trgm pads a string with two leading spaces, so a short
 *               mid-word fragment's trigram set can miss the title's entirely.
 *
 * What that produces is not a clean cutoff. At two characters 'gb' returns
 * "iPhone 12 256GB" (word_similarity 0.333) while 'ph' returns nothing (0.000);
 * at three, 'one' works (0.500) and 'pho' does not (0.250). POSITION AND TRIGRAM
 * DENSITY DECIDE, NOT LENGTH — so a 3-character guard would refuse queries that
 * work today and fix nothing.
 *
 * ONE character is the only case worth blocking, and not because it finds too
 * little. `word_similarity('p', …)` is structurally 0 against any title with no
 * p-initial word, so the trigram branch cannot fire; but the full-text branch
 * still matches unrelated listings whose own words start with 'p', leaving a
 * POPULATED results page that silently lacks what the user was looking for.
 * That is the takedown hazard's shape — a non-empty result set is not evidence
 * that any particular listing is present — and it is the one outcome here that
 * actively misleads rather than merely disappoints.
 */
export const MIN_QUERY_LENGTH = 2;

export type SearchSort = 'relevance' | 'newest' | 'price_asc' | 'price_desc';
export const SEARCH_SORTS: readonly SearchSort[] = [
	'relevance',
	'newest',
	'price_asc',
	'price_desc'
];

const CONDITION_VALUES = new Set<string>(CONDITIONS.map((c) => c.value));
const LOCATION_VALUES = new Set<string>(NAIROBI_AREAS);

/** Normalized, validated search state — the single source of truth for the page. */
export interface SearchParams {
	q: string;
	category: string; // slug, or '' for any
	minPrice: number | null;
	maxPrice: number | null;
	condition: ConditionValue[];
	location: string; // a NAIROBI_AREAS value, or '' for any
	sort: SearchSort;
	page: number;
}

/** The composed RPC arguments + pagination window (the "query description"). */
export interface SearchQuery {
	args: {
		q: string[]; // raw word tokens, AND-matched as full-text terms; [] means no text filter
		category_ids: string[] | null; // subtree-expanded; [] = a real but unknown slug
		min_price: number | null;
		max_price: number | null;
		conditions: ConditionValue[] | null;
		location: string | null; // exact-match area; null = any
		sort: SearchSort;
	};
	from: number;
	to: number;
	page: number;
	/** True when a query is present and relevance ranking applies. */
	ranked: boolean;
	/**
	 * A query too short to run (see MIN_QUERY_LENGTH). The caller skips the RPC
	 * and the page shows guidance instead of results.
	 *
	 * FALSE for a BLANK query — that is a browse, not a short search, and it
	 * legitimately lists everything.
	 */
	tooShort: boolean;
}

function toPositiveInt(value: string | null): number | null {
	if (value === null) return null;
	const cleaned = value.replace(/[,\s]/g, '');
	if (!/^\d+$/.test(cleaned)) return null;
	const n = Number(cleaned);
	return n > 0 ? n : null;
}

/** Split a query into word tokens for AND matching: whitespace splits words,
 *  empty tokens are dropped, the count is capped. Returns [] for a blank query
 *  (→ no text filter).
 *
 *  Tokens are passed through RAW and deliberately un-escaped. All sanitization
 *  happens in `search_listings`, which strips each token to [a-z0-9] before
 *  building the tsquery — a whitelist, so no input can carry tsquery operator
 *  syntax regardless of what any caller sends. A token containing punctuation
 *  expands there into both readings, e.g. "iphone-12" matches both "iPhone 12"
 *  and "iPhone12". The raw form also feeds the trigram typo-rescue fallback,
 *  which needs the original spelling to work. */
export function tokenizeQuery(q: string): string[] {
	return q
		.split(/\s+/)
		.filter((t) => t.length > 0)
		.slice(0, MAX_SEARCH_TOKENS);
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
	// Only accept a location from the fixed list — an unknown value is no filter.
	const locationRaw = (sp.get('location') ?? '').trim();
	const location = LOCATION_VALUES.has(locationRaw) ? locationRaw : '';
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
		location,
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
			location: params.location || null,
			sort: params.sort
		},
		from,
		to: from + SEARCH_PAGE_SIZE - 1,
		page: params.page,
		ranked: tokens.length > 0 && params.sort === 'relevance',
		// `params.q` is already trimmed by parseSearchParams, so this is the typed
		// query's real length. Measured on the whole query rather than per token:
		// the guard exists to stop a single character reaching the tsquery, and
		// "p" is the only shape that produces one.
		tooShort: params.q.length > 0 && params.q.length < MIN_QUERY_LENGTH
	};
}
