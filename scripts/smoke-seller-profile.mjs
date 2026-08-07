/**
 * Seller-profile smoke, run per deployment tier.
 *
 *   node scripts/smoke-seller-profile.mjs <base-url> <tier-label>
 *
 * Read-only: GETs public pages, writes nothing, needs no credentials. All three
 * tiers share one hosted database, so the fixtures below are present on each.
 *
 * DESIGN RULE (SP-18), learned the hard way twice in one phase: an assertion
 * that cannot fail for the reason it claims to test is not an assertion. Two
 * concrete traps this file exists to avoid —
 *
 *   1. Matching content against the WHOLE document. The aggregate check used to
 *      be `html.includes('4.0')`, which passed because "4.0" appears 21 times in
 *      the star SVG's path data. It could never have failed. Every content
 *      assertion here is therefore scoped to the region under test.
 *   2. Hard-coding fixture wording. Review bodies and listing titles are data a
 *      human may legitimately change; asserting on them tests the fixture, not
 *      the app. Nothing below matches seeded text — only app copy and structure.
 */

const base = process.argv[2]?.replace(/\/$/, '');
const tier = process.argv[3] ?? 'unknown';
if (!base) {
	console.error('usage: node scripts/smoke-seller-profile.mjs <base-url> <tier-label>');
	process.exit(2);
}

// Fixtures, by id only — never by their content.
const CORE_SELLER = 'efe39d90-47d7-4834-99da-31291546a55d'; // has a review on a deleted listing
const NO_REVIEW_SELLER = 'a69c0749-2585-4b95-b2cd-ace870bcbc4a'; // listings, no reviews
const BUYER = '52811df9-cd67-4dd4-abec-5d35c435579c'; // role = buyer   → 404 (SP-16)
const ADMIN = '33e58dc4-c914-48a8-b40b-21019445fc3e'; // role = admin   → 404 (SP-17)
const MISSING = '11111111-1111-4111-8111-111111111111';

let failed = 0;
let passed = 0;
function check(name, ok, detail = '') {
	if (ok) passed++;
	else failed++;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function get(path) {
	const res = await fetch(`${base}${path}`, { redirect: 'manual' });
	return { status: res.status, html: await res.text() };
}

// ── Region extraction ───────────────────────────────────────────────────────
// Crude but sufficient: none of these elements nest on the pages under test, so
// a non-greedy match to the closing tag is exact.
const slice = (html, open, close) => {
	const i = html.search(open);
	if (i < 0) return null;
	const j = html.indexOf(close, i);
	return j < 0 ? null : html.slice(i, j + close.length);
};
const mainOf = (html) => slice(html, /<main[\s>]/, '</main>') ?? '';
const headerOf = (main) => slice(main, /<header[\s>]/, '</header>') ?? '';
const sectionsOf = (main) =>
	[...main.matchAll(/<section[^>]*>[\s\S]*?<\/section>/g)].map((m) => m[0]);
const sectionWith = (main, needle) => sectionsOf(main).find((s) => s.includes(needle)) ?? '';
const rowsOf = (section) => [...section.matchAll(/<li[^>]*>[\s\S]*?<\/li>/g)].map((m) => m[0]);
const textOf = (html) =>
	html
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

console.log(`\n=== seller-profile smoke: ${tier} (${base}) ===\n`);

// 1 ── Walk in from the public grid, the way a buyer arrives.
const home = await get('/');
check('home responds 200', home.status === 200, `status ${home.status}`);
const homeMain = mainOf(home.html);
const listingIds = [
	...new Set([...homeMain.matchAll(/href="\/listings\/([0-9a-f-]{36})"/g)].map((m) => m[1]))
];
check(
	'home grid offers listings to walk from',
	listingIds.length > 0,
	`${listingIds.length} found`
);
if (!listingIds.length) process.exit(1);

// 2 ── The entry point must be in the SSR HTML, inside the page body — not
//      injected by hydration, and not something in the layout chrome.
let sellerId = null;
for (const id of listingIds.slice(0, 6)) {
	const lp = await get(`/listings/${id}`);
	if (lp.status !== 200) continue;
	const m = mainOf(lp.html).match(/href="\/sellers\/([0-9a-f-]{36})"/);
	if (m) {
		sellerId = m[1];
		break;
	}
}
check('entry-point anchor present in listing-page SSR body', !!sellerId, sellerId ?? 'none found');

// 3 ── The core scenario: a review whose listing has since been deleted.
const core = await get(`/sellers/${CORE_SELLER}`);
check('core: profile responds 200', core.status === 200, `status ${core.status}`);
const coreMain = mainOf(core.html);
const coreHeader = headerOf(coreMain);
const coreReviews = sectionWith(coreMain, '>Reviews');
const coreListings = sectionWith(coreMain, 'Active listings');

check('core: profile renders an h1', /<h1[^>]*>[\s\S]*?\S[\s\S]*?<\/h1>/.test(coreMain));
check('core: a reviews section exists', coreReviews.length > 0);
check('core: a listings section exists', coreListings.length > 0);

const coreRows = rowsOf(coreReviews);
// Structural, not textual: the fixture's wording is a human's to change.
check(
	'core: at least one review row is rendered',
	coreRows.length > 0,
	`${coreRows.length} row(s)`
);

const unreachable = coreRows.filter((r) => r.includes('(no longer available)'));
check('core: a row carries the unreachable-listing marker', unreachable.length > 0);
check(
	'core: that row links nowhere',
	unreachable.length > 0 && unreachable.every((r) => !/href="\/listings\//.test(r)),
	'no /listings/ href inside the row'
);

// 4 ── Aggregate cross-check.
//
// This deliberately compares TWO INDEPENDENT DATA PATHS: the header average comes
// from the trigger-maintained `profiles.review_count` / `rating_sum` columns, while
// the row ratings come from the reviews query. Agreement means the denormalized
// aggregate and the rows it summarises have not drifted apart — which no single
// query could tell you.
//
// MUST NOT be simplified to a hard-coded constant. A literal expected value is
// exactly the defect this replaced: it cannot fail when the underlying value
// changes, and it silently stops testing anything the moment the fixture moves.
const rowRatings = coreRows
	.map((r) => r.match(/aria-label="[^"]*?rated ([\d.]+) out of 5"/))
	.filter(Boolean)
	.map((m) => Number(m[1]));
const headerAvg = textOf(coreHeader).match(/(\d+\.\d)/);
const capped = /Showing the \d+ most recent/.test(coreReviews);

if (capped) {
	// The shown rows are a subset, so their mean is not the profile's average.
	console.log('SKIP  core: aggregate cross-check — review list is capped, rows are a subset');
} else {
	const expected = rowRatings.length
		? (rowRatings.reduce((a, b) => a + b, 0) / rowRatings.length).toFixed(1)
		: null;
	check(
		'core: header aggregate equals the average of the rendered rows',
		!!headerAvg && !!expected && headerAvg[1] === expected,
		`header ${headerAvg?.[1] ?? 'none'} vs rows ${expected ?? 'none'} (${rowRatings.length} row(s))`
	);
}

// 5 ── A seller with no reviews still has a page, and says so in the ruled words.
const quiet = await get(`/sellers/${NO_REVIEW_SELLER}`);
check('seller with no reviews responds 200', quiet.status === 200, `status ${quiet.status}`);
const quietReviews = sectionWith(mainOf(quiet.html), '>Reviews');
check(
	'zero-state copy is the ruled wording, in the reviews section',
	quietReviews.includes('Reviews will appear here once buyers complete an order.')
);

// 6 ── Every shape that must 404.
const missing = await get(`/sellers/${MISSING}`);
check('nonexistent profile id 404s', missing.status === 404, `status ${missing.status}`);

const malformed = await get('/sellers/not-a-uuid');
check('malformed profile id 404s', malformed.status === 404, `status ${malformed.status}`);

const buyer = await get(`/sellers/${BUYER}`);
check('buyer-role profile 404s (SP-16)', buyer.status === 404, `status ${buyer.status}`);
check(
	'that 404 is byte-identical to the missing-id 404',
	buyer.status === missing.status && buyer.html === missing.html,
	'anything distinguishable makes accounts enumerable'
);

const admin = await get(`/sellers/${ADMIN}`);
check('admin-role profile 404s (SP-17)', admin.status === 404, `status ${admin.status}`);

console.log(`\n=== ${tier}: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
