/**
 * Review helpers shared by every surface that renders a rating.
 *
 * The aggregates on `listings` and `profiles` are stored as a (count, sum) pair
 * rather than an average — the triggers can move a pair with integer arithmetic
 * and no precision loss, and the average is a read-time concern. That makes this
 * the single place the division happens, so "4.6" means the same thing on a card,
 * a listing page and a seller block.
 *
 * Note the deliberate split from the SQL: search ranks by a DAMPENED score
 * (Reviews PRD D7), but nothing here ever displays it. A buyer reading "4.6"
 * expects the plain mean of what they can scroll through, so the dampening stays
 * in the ORDER BY where it belongs and never leaks into the UI.
 */

/** D3 — body cap, mirrored by `reviews_body_check` in SQL. */
export const REVIEW_BODY_MAX = 1000;

/** D5 — seller response cap, mirrored by `reviews_seller_response_len` in SQL. */
export const REVIEW_RESPONSE_MAX = 1000;

/** The 1–5 values a rating may take, low to high. */
export const RATING_VALUES = [1, 2, 3, 4, 5] as const;

export type RatingValue = (typeof RATING_VALUES)[number];

/** What each star means when picking one. Used as the radio labels. */
export const RATING_LABELS: Record<RatingValue, string> = {
	1: 'Poor',
	2: 'Fair',
	3: 'Good',
	4: 'Very good',
	5: 'Excellent'
};

export interface Aggregate {
	reviewCount: number;
	ratingSum: number;
}

/**
 * Plain mean, or null when there is nothing to average.
 *
 * Null rather than 0 is the point: a zero-review listing has no rating, and
 * every surface must say "No reviews yet" instead of rendering 0.0, which reads
 * as a terrible rating rather than an absent one.
 */
export function averageRating({ reviewCount, ratingSum }: Aggregate): number | null {
	if (!reviewCount || reviewCount <= 0) return null;
	return ratingSum / reviewCount;
}

/** One decimal, always — "5" alone looks like a count, "5.0" reads as a rating. */
export function formatAverage(average: number): string {
	return average.toFixed(1);
}

/**
 * Screen-reader text for a rating. Kept here so it never drifts per surface.
 *
 * `subject` names WHAT is being rated. A listing page carries several ratings —
 * the item's, the seller's, and one per review — and sighted readers tell them
 * apart by where they sit. Placement conveys nothing to a screen reader, so
 * without a subject they all announce the identical sentence and the seller's
 * rating is indistinguishable from the item's.
 */
export function ratingLabel(average: number, subject?: string): string {
	const score = `${formatAverage(average)} out of 5`;
	return subject ? `${subject} rated ${score}` : `Rated ${score}`;
}

/** "1 review" / "12 reviews" — the count that sits beside the stars. */
export function reviewCountLabel(count: number): string {
	return `${count} ${count === 1 ? 'review' : 'reviews'}`;
}

/**
 * Clamp an average to the 0–100% width the star overlay is drawn at.
 * Guards against an aggregate that has drifted out of the 1–5 band; the overlay
 * must never render wider than the row of stars beneath it.
 */
export function ratingFillPercent(average: number): number {
	return Math.max(0, Math.min(100, (average / 5) * 100));
}

/**
 * Validate a submitted rating. Returns the parsed value, or null when the input
 * is anything other than an integer 1–5 — the same domain
 * `reviews_rating_check` enforces in SQL.
 */
export function parseRating(raw: FormDataEntryValue | null): RatingValue | null {
	const n = Number(String(raw ?? '').trim());
	if (!Number.isInteger(n)) return null;
	return (RATING_VALUES as readonly number[]).includes(n) ? (n as RatingValue) : null;
}

/**
 * Normalize an optional free-text body: trim, treat blank as absent.
 * Returns `{ ok: false }` when it exceeds the cap so the caller can fail the
 * action rather than letting the database constraint produce a 500.
 */
export function parseBody(
	raw: FormDataEntryValue | null,
	max = REVIEW_BODY_MAX
): { ok: true; value: string | null } | { ok: false } {
	const text = String(raw ?? '').trim();
	if (text.length > max) return { ok: false };
	return { ok: true, value: text.length ? text : null };
}
