import { error } from '@sveltejs/kit';
import { loadCategoryTree } from '$lib/server/categories';
import { listVisibleReviewsForSeller } from '$lib/server/reviews';
import { REVIEW_PAGE_CAP } from '$lib/reviews';
import { toCardData } from '$lib/listings-view';
import { subcategoryNameMap } from '$lib/validation/listings';
import type { PageServerLoad } from './$types';

/**
 * How many active listings the profile grid shows (SP-9).
 *
 * A plain cap in the home page's style, not the numbered pager `/search` and
 * `/c/[slug]` carry: that pager is bound to the search-params model
 * (`parseSearchParams` / `buildFilterUrl`) which this route has no part of, and
 * this page already caps its review list rather than paginating it. One
 * treatment per page beats two.
 */
const ACTIVE_LISTINGS_CAP = 24;

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	// All four reads are keyed off the route param alone — none depends on what
	// another returns — so they go out together and the 404 is decided after.
	// (The listing page fetches its row first only because everything it loads
	// afterwards needs that row's ids; there is no such dependency here.)
	const [profileRes, listingsRes, tree, reviews] = await Promise.all([
		// D6 — an explicit column list, never `select *`. This is presentation
		// discipline, not a security boundary: `profiles_select` is `using (true)`,
		// so anon can read `phone` and every other column straight from PostgREST
		// regardless of what this page ships (SP-5, and the deferred hardening
		// item). What it does guarantee is that `phone`, `location` and `role`
		// never enter this page's payload. Same columns the listing page's seller
		// block selects.
		// `role` is read for the SP-16 gate below and never returned — see the
		// destructure at the end, which is why this select is not spread wholesale.
		supabase
			.from('profiles')
			.select('full_name, avatar_url, created_at, review_count, rating_sum, role')
			.eq('id', params.id)
			.maybeSingle(),

		// The card contract, fed from a straight listings query — no RPC, because
		// this grid has no query, no ranking and no filters. `count: 'exact'` comes
		// back on the SAME request as the capped rows, so the "showing 24 of N"
		// note costs nothing extra (SP-9 anticipated a second query; there isn't one).
		supabase
			.from('listings')
			.select(
				'id, title, price, location_area, condition, published_at, created_at, type, category_id, review_count, rating_sum, listing_images(storage_path, position)',
				{ count: 'exact' }
			)
			.eq('seller_id', params.id)
			.eq('status', 'active')
			.order('published_at', { ascending: false })
			.order('id', { ascending: true }) // stable tiebreaker, per the home page
			.limit(ACTIVE_LISTINGS_CAP),

		// Needed for `categoryLabel`, which is not a column: it is resolved per row
		// from the tree. Without it the photo-less SERVICE card variant loses the
		// label that is the whole point of that variant.
		loadCategoryTree(supabase),

		// Visible-only (SP-1). The seller's own sales page deliberately skips this
		// filter; a public page cannot — see listVisibleReviewsForSeller.
		listVisibleReviewsForSeller(supabase, params.id, REVIEW_PAGE_CAP)
	]);

	// D1, split by SP-3 and extended to a third case by SP-16. Three outcomes:
	//
	//  1. No such profile — a hard 404, mirroring `/listings/[id]`. A malformed
	//     uuid lands here too: PostgREST rejects it, `maybeSingle` yields null
	//     data, and a bad id is a missing page either way.
	//  2. The profile exists but is NOT a seller — also a hard 404, and
	//     deliberately the SAME one: same status, same message, nothing that
	//     distinguishes it from case 1. Otherwise every account on the platform
	//     becomes enumerable by URL, and rendering the page instead would assert
	//     something false — a buyer framed as a seller with an empty shop. D6
	//     governs exactly this kind of presentation-layer framing.
	//  3. A seller with an empty history — NOT an error. That one is the page's
	//     job, and it gets the D2 zero states.
	//
	// The test is POSITIVE (`=== 'seller'`) rather than `!== 'buyer'`, so a role
	// added later fails closed and has to be admitted on purpose (SP-16). `admin`
	// fails it today by design (SP-17) — the reconciliation that implies is a
	// named deferred decision, not an oversight.
	const profile = profileRes.data;
	if (!profile || profile.role !== 'seller') error(404, 'Seller not found');

	const names = subcategoryNameMap(tree);
	const listings = (listingsRes.data ?? []).map((l) =>
		toCardData(supabase, { ...l, categoryLabel: names.get(l.category_id) ?? null })
	);

	// `role` was read for the gate above and stops here. Written out field by field
	// rather than spread-minus-role, so what the page ships is a list you can read
	// in one glance — the same discipline D6 asks of the select itself.
	const seller = {
		full_name: profile.full_name,
		avatar_url: profile.avatar_url,
		created_at: profile.created_at,
		review_count: profile.review_count,
		rating_sum: profile.rating_sum
	};

	return {
		seller,
		reviews,
		listings,
		// Totals the page needs to say what it is showing. `reviewTotal` comes from
		// the trigger-maintained aggregate rather than a count query — it is the
		// same number the seller-level average is computed from, so the list note
		// and the aggregate can never disagree.
		reviewTotal: profile.review_count,
		listingTotal: listingsRes.count ?? listings.length,
		listingCap: ACTIVE_LISTINGS_CAP
	};
};
