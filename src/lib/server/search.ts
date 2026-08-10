import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { toCardData, type ListingCardData } from '$lib/listings-view';
import type { SearchQuery } from '$lib/search';

type RpcArgs = Database['public']['Functions']['search_listings']['Args'];

/**
 * Execute a composed search: call the `search_listings` RPC — active-only
 * full-text search over the weighted title/description vector, ranked by
 * `ts_rank`, with a trigram typo-rescue fallback that fires only when a
 * non-empty query matches nothing — then paginate with PostgREST `range` and
 * get an exact count. Cover images are fetched for the page's rows and
 * attached, then mapped to card view-models. Null args are omitted so the SQL
 * defaults apply.
 */
export async function runSearch(
	supabase: SupabaseClient<Database>,
	query: SearchQuery,
	/** subcategory id → name, so photo-less service cards can show their label. */
	categoryNames?: Map<string, string>
): Promise<{ listings: ListingCardData[]; total: number }> {
	const args: RpcArgs = { q: query.args.q, sort: query.args.sort };
	if (query.args.category_ids !== null) args.category_ids = query.args.category_ids;
	if (query.args.min_price !== null) args.min_price = query.args.min_price;
	if (query.args.max_price !== null) args.max_price = query.args.max_price;
	if (query.args.conditions !== null) args.conditions = query.args.conditions;
	if (query.args.location !== null) args.location = query.args.location;

	const { data, count, error } = await supabase
		.rpc('search_listings', args, { count: 'exact' })
		.range(query.from, query.to);

	if (error || !data) {
		// Deliberately swallowed for the caller — an empty grid beats an error page —
		// but a failing search is otherwise completely invisible. Log the tokens and
		// which filters were active, which is what it takes to reproduce a tsquery
		// construction failure.
		console.error('[search] search_listings RPC failed', {
			message: error?.message,
			code: error?.code,
			details: error?.details,
			hint: error?.hint,
			tokens: query.args.q,
			sort: query.args.sort,
			filters: {
				category: query.args.category_ids !== null,
				minPrice: query.args.min_price !== null,
				maxPrice: query.args.max_price !== null,
				condition: query.args.conditions !== null,
				location: query.args.location !== null
			},
			page: query.page
		});
		return { listings: [], total: 0 };
	}

	// Cover images for just this page's rows.
	const ids = data.map((r) => r.id);
	const imagesByListing = new Map<string, { storage_path: string; position: number }[]>();
	if (ids.length) {
		const { data: imgs } = await supabase
			.from('listing_images')
			.select('listing_id, storage_path, position')
			.in('listing_id', ids);
		for (const img of imgs ?? []) {
			const arr = imagesByListing.get(img.listing_id) ?? [];
			arr.push({ storage_path: img.storage_path, position: img.position });
			imagesByListing.set(img.listing_id, arr);
		}
	}

	const listings = data.map((r) =>
		toCardData(supabase, {
			id: r.id,
			title: r.title,
			price: r.price,
			location_area: r.location_area,
			condition: r.condition,
			published_at: r.published_at,
			created_at: r.created_at,
			type: r.type,
			categoryLabel: categoryNames?.get(r.category_id) ?? null,
			// search_listings is `returns setof public.listings`, so the review
			// aggregates arrive with the row — no extra select, no per-card query.
			review_count: r.review_count,
			rating_sum: r.rating_sum,
			// Boosts BST-6. Same free ride as the review aggregates: the column is on
			// `listings`, so it comes back with the row and the badge costs nothing.
			// Passed HERE and nowhere else — search and category browse are the only
			// surfaces the boost ordering term reaches, so they are the only ones
			// entitled to disclose paid placement.
			boosted_until: r.boosted_until,
			listing_images: imagesByListing.get(r.id) ?? []
		})
	);

	return { listings, total: count ?? 0 };
}
