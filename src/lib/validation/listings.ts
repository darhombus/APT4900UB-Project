import { z } from 'zod';

/**
 * Listing form validation, shared by the client (progressive-enhancement hints)
 * and the server action (authoritative). Everything here is pure and
 * unit-testable — no `$env`, no Supabase client — so it imports cleanly into both
 * the browser component and the server.
 *
 * The schemas mirror the ACTUAL database constraints (see
 * 20260710013856_initial_schema.sql and the listings-phase rulings), which win
 * over the PRD's superseded numbers:
 *   - title        3–120 chars   (CHECK char_length(title) between 3 and 120)
 *   - description  ≤ 5000 chars   (CHECK char_length(description) <= 5000)
 *   - price        > 0, whole KSh (CHECK price > 0; entered as an integer)
 *   - category     must be a *subcategory* (a category with a parent), never a
 *                  top-level one — enforced against the tree in the action.
 *
 * `type` is never a form field: the action derives it from the chosen
 * subcategory's top-level ancestor (Small Services → 'service', else 'product').
 * `condition` is required for goods at publish, and forced null for services (the
 * `condition_products_only` CHECK).
 */

/** The item_condition enum values, with the display labels the UI shows. */
export const CONDITIONS = [
	{ value: 'new', label: 'New' },
	{ value: 'used_like_new', label: 'Used — like new' },
	{ value: 'used_good', label: 'Used — good' },
	{ value: 'used_fair', label: 'Used — fair' }
] as const;

export type ConditionValue = (typeof CONDITIONS)[number]['value'];

const CONDITION_VALUES = CONDITIONS.map((c) => c.value) as [ConditionValue, ...ConditionValue[]];

/** Display label for a stored condition value ("used_good" → "Used — good"). */
export function conditionLabel(value: string): string {
	return CONDITIONS.find((c) => c.value === value)?.label ?? value;
}

/** Common Nairobi areas offered as a datalist on the free-text location field. */
export const NAIROBI_AREAS = [
	'Westlands',
	'Kilimani',
	'Kasarani',
	'Embakasi',
	'Karen',
	"Lang'ata",
	'Roysambu',
	'South B',
	'South C',
	'Donholm',
	'Ruaka',
	'CBD'
] as const;

/** Fixed slug of the one top-level category whose listings are services. */
export const SMALL_SERVICES_SLUG = 'small-services';

// ── Category tree shapes ────────────────────────────────────────────────────
// Structurally compatible with `CategoryTreeNode` from
// $lib/server/categories.ts, but defined here so this module (and the client
// component) never imports server-only code.
export interface CategoryNode {
	id: string;
	name: string;
	slug: string;
	sort_order: number;
}
export interface CategoryTree extends CategoryNode {
	children: CategoryNode[];
}

/** Find a subcategory by id anywhere in the tree, with its top-level parent. */
export function findSubcategory(
	tree: CategoryTree[],
	categoryId: string
): { top: CategoryTree; sub: CategoryNode } | null {
	for (const top of tree) {
		const sub = top.children.find((c) => c.id === categoryId);
		if (sub) return { top, sub };
	}
	return null;
}

/** True when a top-level category holds services rather than goods. */
export function isServiceTop(top: { slug: string }): boolean {
	return top.slug === SMALL_SERVICES_SLUG;
}

/** The listing_type a subcategory implies, from its top-level ancestor. */
export function listingTypeForTop(top: { slug: string }): 'product' | 'service' {
	return isServiceTop(top) ? 'service' : 'product';
}

// ── Price helpers ───────────────────────────────────────────────────────────

/**
 * Format an integer price with thousands separators for display ("2,500").
 * Leaves non-integer input untouched so an invalid entry still shows what the
 * user typed (and gets the matching server error) rather than being mangled.
 */
export function formatThousands(value: string): string {
	const cleaned = value.replace(/[,\s]/g, '');
	if (cleaned === '') return '';
	if (!/^\d+$/.test(cleaned)) return value;
	return Number(cleaned).toLocaleString('en-KE');
}

// ── Field schemas ───────────────────────────────────────────────────────────

const title = z
	.string()
	.trim()
	.min(3, 'Title must be at least 3 characters')
	.max(120, 'Title must be 120 characters or fewer');

// KSh, whole numbers only. Thousands separators/spaces are stripped first, then
// the value must be a positive integer within numeric(12,2)'s range.
const price = z.preprocess(
	(v) => {
		if (typeof v !== 'string') return v;
		const cleaned = v.replace(/[,\s]/g, '');
		return cleaned === '' ? undefined : Number(cleaned);
	},
	z
		.number({ error: 'Enter a price' })
		.int('Enter a whole number, e.g. 2500')
		.positive('Price must be greater than 0')
		.max(9_999_999_999, 'Price is too large')
);

const categoryId = z.string().min(1, 'Choose a category');

const locationArea = z
	.string()
	.trim()
	.max(120, 'Location is too long')
	.optional()
	.transform((v) => (v ? v : undefined));

// Empty string (nothing chosen) becomes undefined so the enum doesn't reject it;
// the goods-required / services-null rules are applied in the action once the
// listing type is known from the category.
const condition = z.preprocess(
	(v) => (v === '' || v == null ? undefined : v),
	z.enum(CONDITION_VALUES).optional()
);

/**
 * "Save draft" — the minimum the DB will accept. Title, price, and category are
 * still required because their columns are NOT NULL (and title/price carry CHECK
 * constraints); description may be blank and condition may be omitted.
 */
export const draftListingSchema = z.object({
	title,
	description: z.string().trim().max(5000, 'Description must be 5000 characters or fewer'),
	price,
	categoryId,
	locationArea,
	condition
});

/**
 * "Publish" — full validation. Adds a non-empty description; the condition and
 * at-least-one-photo rules for goods are enforced in the action (they depend on
 * the category's derived type and on stored images).
 */
export const publishListingSchema = draftListingSchema.extend({
	description: z
		.string()
		.trim()
		.min(1, 'Add a description')
		.max(5000, 'Description must be 5000 characters or fewer')
});

export type DraftListingInput = z.infer<typeof draftListingSchema>;

// ── Listing lifecycle (Section 8) ────────────────────────────────────────────
// The confirmed decisions block (ruling #5) governs this, over the PRD's Section 8
// prompt text. `paused` is the Unpublish state; a listing that has ever been
// published never returns to draft; `removed` is admin-only (no transition here).

export type ListingStatus = 'draft' | 'active' | 'paused' | 'sold' | 'removed';
export type ListingTransition =
	'publish' | 'unpublish' | 'republish' | 'markSold' | 'relist' | 'delete';

/**
 * How a transition touches published_at:
 *   'first'    — stamp now() only if it was never set (the first publish)
 *   'now'      — (re)stamp now() (Relist)
 *   'preserve' — leave it untouched (Unpublish / Republish / Mark as sold)
 */
export type PublishedAtRule = 'first' | 'now' | 'preserve';

interface TransitionRule {
	/** The status(es) a listing may be in for this transition to be legal. */
	from: readonly ListingStatus[];
	to: ListingStatus;
	publishedAt: PublishedAtRule;
}

/**
 * The listing lifecycle as a state machine:
 *   draft         ──Publish───▶ active   (first publish stamps published_at)
 *   active        ──Unpublish─▶ paused   (published_at preserved)
 *   paused        ──Republish─▶ active   (published_at preserved — NOT refreshed)
 *   active/paused ──Mark sold─▶ sold     (a paused listing can be closed out
 *                                          directly, without going public again)
 *   sold          ──Relist────▶ active   (published_at re-stamped to now())
 *   draft         ──Delete────▶ (gone)   (only a still-draft listing can be deleted)
 * There is deliberately no active→draft or paused→draft: once published, a
 * listing can't go back to draft.
 */
export const LISTING_TRANSITIONS: Record<ListingTransition, TransitionRule> = {
	publish: { from: ['draft'], to: 'active', publishedAt: 'first' },
	unpublish: { from: ['active'], to: 'paused', publishedAt: 'preserve' },
	republish: { from: ['paused'], to: 'active', publishedAt: 'preserve' },
	markSold: { from: ['active', 'paused'], to: 'sold', publishedAt: 'preserve' },
	relist: { from: ['sold'], to: 'active', publishedAt: 'now' },
	// `to` is unused for delete (the row is removed); `from` gates its legality.
	delete: { from: ['draft'], to: 'draft', publishedAt: 'preserve' }
};

/**
 * Pure legality check: the resulting status + published_at rule when the
 * transition is legal from `currentStatus`, else null. The server helper trusts
 * this — never the client's view of the current status.
 */
export function planTransition(
	transition: ListingTransition,
	currentStatus: ListingStatus
): { to: ListingStatus; publishedAt: PublishedAtRule } | null {
	const rule = LISTING_TRANSITIONS[transition];
	if (!rule.from.includes(currentStatus)) return null;
	return { to: rule.to, publishedAt: rule.publishedAt };
}
