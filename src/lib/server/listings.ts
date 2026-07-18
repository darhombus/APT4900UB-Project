import { error, fail, redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { loadCategoryTree } from '$lib/server/categories';
import { fieldErrors } from '$lib/validation/auth';
import {
	draftListingSchema,
	publishListingSchema,
	findSubcategory,
	isServiceTop,
	listingTypeForTop,
	planTransition,
	publishGoodsErrors,
	type CategoryTree,
	type ListingTransition
} from '$lib/validation/listings';
import { LISTING_IMAGES_BUCKET } from '$lib/listing-images';
import type { Database } from '$lib/types/database';

export type { ListingTransition } from '$lib/validation/listings';

type ListingStatus = Database['public']['Enums']['listing_status'];
type ItemCondition = Database['public']['Enums']['item_condition'];

/** What the two save buttons mean. `publish` also covers "Save changes" on an
 *  already-live listing (full validation, status preserved). */
export type SaveIntent = 'draft' | 'publish';

interface ExistingListing {
	id: string;
	seller_id: string;
	status: ListingStatus;
	published_at: string | null;
}

const field = (fd: FormData, key: string) => String(fd.get(key) ?? '');

/**
 * Authoritative create-or-update for a listing, shared by the new and edit
 * routes. Validation here is the source of truth (the client's is only a
 * progressive-enhancement convenience). All writes run through `locals.supabase`
 * so RLS scopes them to the caller.
 *
 * `listingIdFromRoute` is set on the edit route; on the new route the row id (if
 * a draft was already created lazily so photos could attach) rides in a hidden
 * `listingId` field instead. Either way ownership is re-checked here.
 *
 * Returns a `fail(...)` on validation errors, throws `redirect` to the public
 * page once the listing is live, or returns `{ success, id, status }` when a
 * draft/paused/sold row is saved in place.
 */
export async function saveListingAction(
	event: RequestEvent,
	intent: SaveIntent,
	listingIdFromRoute?: string
) {
	const {
		locals: { supabase, user }
	} = event;
	const sellerId = user!.id;

	const formData = await event.request.formData();
	const raw = {
		title: field(formData, 'title'),
		description: field(formData, 'description'),
		price: field(formData, 'price'),
		categoryId: field(formData, 'categoryId'),
		locationArea: field(formData, 'locationArea'),
		condition: field(formData, 'condition')
	};

	// Validate the payload FIRST, before any database work. An invalid submission
	// (the common fast-fail case) returns here without the target-row lookup, the
	// category tree, or an image count — so it costs a request parse, nothing more.
	// The client mirrors this schema, so with JS an invalid form never even POSTs;
	// the server stays authoritative for the no-JS path and forged requests.
	const schema = intent === 'publish' ? publishListingSchema : draftListingSchema;
	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		return fail(400, { errors: fieldErrors(parsed.error), values: raw });
	}
	const data = parsed.data;

	// Resolve the target row: the edit route's param, or a new-page draft's hidden
	// id. Owner-only — the edit load already 404s strangers, but re-check so the
	// action is safe standalone and a forged hidden id can't hit another seller.
	const targetId = listingIdFromRoute ?? (field(formData, 'listingId') || null);
	let existing: ExistingListing | null = null;
	if (targetId) {
		const { data: row } = await supabase
			.from('listings')
			.select('id, seller_id, status, published_at')
			.eq('id', targetId)
			.maybeSingle();
		if (!row || row.seller_id !== sellerId) {
			if (listingIdFromRoute) error(404, 'Not found');
			return fail(400, {
				formError: 'That listing could not be found. Reload the page and try again.',
				values: raw
			});
		}
		existing = row;
	}

	// The category must resolve to a real subcategory (never a top-level one) — the
	// one validation that genuinely needs data, so it follows the read; the cheap
	// schema checks already passed above.
	const tree = (await loadCategoryTree(supabase)) as CategoryTree[];
	const match = findSubcategory(tree, data.categoryId);
	const errors: Record<string, string> = {};
	if (!match) errors.categoryId = 'Choose a subcategory';

	const service = match ? isServiceTop(match.top) : false;

	// Services store a null condition; goods keep the chosen value.
	const condition: ItemCondition | null = match && !service ? (data.condition ?? null) : null;

	// Publish rules for goods (a condition and at least one photo); services are
	// exempt. The rule itself lives in publishGoodsErrors() so it's unit-tested.
	if (intent === 'publish' && match) {
		let imageCount = 0;
		if (!service && existing) {
			const { count } = await supabase
				.from('listing_images')
				.select('id', { count: 'exact', head: true })
				.eq('listing_id', existing.id);
			imageCount = count ?? 0;
		}
		Object.assign(errors, publishGoodsErrors({ isService: service, condition, imageCount }));
	}

	// `!match` is implied by errors being non-empty (it sets categoryId), but keep it
	// explicit so `match` narrows to non-null for the payload below.
	if (!match || Object.keys(errors).length > 0) {
		return fail(400, { errors, values: raw });
	}

	const payload = {
		title: data.title,
		description: data.description,
		price: data.price,
		category_id: match.sub.id,
		type: listingTypeForTop(match.top),
		condition,
		location_area: data.locationArea ?? null
	};

	// Editing never silently changes status: only a draft (or a brand-new row)
	// goes active on publish, and published_at is stamped on the FIRST publish only.
	let nextStatus: ListingStatus;
	let stampPublishedAt = false;
	if (existing) {
		if (intent === 'publish' && existing.status === 'draft') {
			nextStatus = 'active';
			stampPublishedAt = !existing.published_at;
		} else {
			nextStatus = existing.status;
		}
	} else {
		nextStatus = intent === 'publish' ? 'active' : 'draft';
		stampPublishedAt = intent === 'publish';
	}

	let id: string;
	if (existing) {
		const patch: Database['public']['Tables']['listings']['Update'] = {
			...payload,
			status: nextStatus
		};
		if (stampPublishedAt) patch.published_at = new Date().toISOString();
		const { error: err } = await supabase.from('listings').update(patch).eq('id', existing.id);
		if (err)
			return fail(500, {
				formError: 'Could not save your listing. Please try again.',
				values: raw
			});
		id = existing.id;
	} else {
		const insert: Database['public']['Tables']['listings']['Insert'] = {
			...payload,
			seller_id: sellerId,
			status: nextStatus,
			published_at: stampPublishedAt ? new Date().toISOString() : null
		};
		const { data: row, error: err } = await supabase
			.from('listings')
			.insert(insert)
			.select('id')
			.single();
		if (err || !row)
			return fail(500, {
				formError: 'Could not create your listing. Please try again.',
				values: raw
			});
		id = row.id;
	}

	// Once the listing is live, send the seller to its public page.
	if (nextStatus === 'active') redirect(303, `/listings/${id}`);

	// A draft (or preserved paused/sold) save stays on the form so the seller can
	// keep working — e.g. add photos to a freshly-created draft.
	return { success: true, id, status: nextStatus } as const;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status transitions (Section 8 management view)
//
// The lifecycle (confirmed decisions block, ruling #5) is a small state machine —
// `planTransition()` in the validation module owns the rules. Every move is gated
// on the row's CURRENT stored status here (never the client's view), so a stale
// tab or a forged POST can't drive an illegal transition. `removed` is reserved
// for admin moderation and isn't reachable from here.
//
//   draft  ──Publish───▶ active   (full publish validation; first publish
//                                   stamps published_at)
//   active ──Unpublish─▶ paused   (published_at preserved)
//   paused ──Republish─▶ active   (published_at preserved — NOT refreshed)
//   active ──Mark sold─▶ sold
//   sold   ──Relist────▶ active   (published_at re-stamped to now())
//   draft  ──Delete────▶ (gone)   (hard delete; RLS allows it only for drafts;
//                                   storage objects removed too)
// ─────────────────────────────────────────────────────────────────────────────

/** Past-tense verb for the "can no longer be …" conflict message. */
const TRANSITION_VERB: Record<ListingTransition, string> = {
	publish: 'published',
	unpublish: 'unpublished',
	republish: 'republished',
	markSold: 'marked as sold',
	relist: 'relisted',
	delete: 'deleted'
};

/** Confirmation message shown after a successful transition. */
const TRANSITION_DONE: Record<ListingTransition, string> = {
	publish: 'Listing published.',
	unpublish: 'Listing unpublished — buyers can’t see it now.',
	republish: 'Listing republished.',
	markSold: 'Marked as sold.',
	relist: 'Listing relisted.',
	delete: 'Listing deleted.'
};

interface StoredListing {
	title: string;
	description: string;
	price: number | string;
	category_id: string;
	condition: string | null;
}

/**
 * Re-validate an already-stored listing against the SAME publish rules the
 * Section 7 form enforces (full field validation + a category that resolves to a
 * subcategory + condition and at least one photo for goods). Used when publishing
 * straight from the management view, where there's no form to submit.
 */
function validateStoredForPublish(
	listing: StoredListing,
	tree: CategoryTree[],
	imageCount: number
) {
	const parsed = publishListingSchema.safeParse({
		title: listing.title,
		description: listing.description,
		price: listing.price,
		categoryId: listing.category_id,
		locationArea: '',
		condition: listing.condition ?? ''
	});
	const errors: Record<string, string> = parsed.success ? {} : fieldErrors(parsed.error);

	const match = findSubcategory(tree, listing.category_id);
	if (!match) errors.categoryId ??= 'This listing’s category is no longer valid.';

	if (match && !isServiceTop(match.top)) {
		if (!listing.condition) errors.condition ??= 'Add the item condition before publishing.';
		if (imageCount < 1) errors.images ??= 'Add at least one photo before publishing.';
	}

	const ok = parsed.success && !!match && Object.keys(errors).length === 0;
	return ok ? { ok: true as const } : { ok: false as const, errors };
}

/**
 * Perform a lifecycle transition, owner- and status-checked server-side. Returns
 * `fail(...)` for an illegal/failed move (409 when the current status doesn't
 * permit it, 400 with `publishErrors` when a publish doesn't pass validation),
 * throws `error(404)` when the listing isn't the caller's, or returns
 * `{ success, id, message }` on success.
 */
export async function transitionListing(
	event: RequestEvent,
	transition: ListingTransition,
	listingId: string
) {
	const {
		locals: { supabase, user }
	} = event;

	const { data: listing } = await supabase
		.from('listings')
		.select(
			'id, seller_id, status, published_at, title, description, price, category_id, condition'
		)
		.eq('id', listingId)
		.maybeSingle();

	if (!listing || listing.seller_id !== user!.id) error(404, 'Not found');

	// Legality is decided purely from the CURRENT stored status.
	const plan = planTransition(transition, listing.status);
	if (!plan) {
		return fail(409, {
			id: listingId,
			transitionError: `This listing can no longer be ${TRANSITION_VERB[transition]} — it’s ${listing.status} now.`
		});
	}

	if (transition === 'delete') {
		// Remove the storage objects first (storage isn't FK-cascaded); the
		// listing_images rows then cascade when the listing row is deleted.
		const { data: imgs } = await supabase
			.from('listing_images')
			.select('storage_path')
			.eq('listing_id', listing.id);
		const paths = (imgs ?? []).map((i) => i.storage_path);
		if (paths.length) await supabase.storage.from(LISTING_IMAGES_BUCKET).remove(paths);

		const { error: delErr } = await supabase
			.from('listings')
			.delete()
			.eq('id', listing.id)
			.eq('status', 'draft'); // RLS also enforces this; belt and braces
		if (delErr)
			return fail(500, { id: listingId, transitionError: 'Could not delete the listing.' });
		return { success: true, id: listingId, deleted: true, message: TRANSITION_DONE.delete };
	}

	if (transition === 'publish') {
		const tree = (await loadCategoryTree(supabase)) as CategoryTree[];
		const { count } = await supabase
			.from('listing_images')
			.select('id', { count: 'exact', head: true })
			.eq('listing_id', listing.id);
		const check = validateStoredForPublish(listing, tree, count ?? 0);
		if (!check.ok) {
			return fail(400, {
				id: listingId,
				publishErrors: check.errors,
				transitionError: 'This listing isn’t ready to publish yet.'
			});
		}
	}

	const patch: Database['public']['Tables']['listings']['Update'] = { status: plan.to };
	if (plan.publishedAt === 'now' || (plan.publishedAt === 'first' && !listing.published_at)) {
		patch.published_at = new Date().toISOString();
	}
	// Re-guard the from-status atomically at write time (defends against a race
	// with another tab).
	const { error: updErr } = await supabase
		.from('listings')
		.update(patch)
		.eq('id', listing.id)
		.eq('status', listing.status);
	if (updErr) return fail(500, { id: listingId, transitionError: 'Could not update the listing.' });
	return { success: true, id: listingId, message: TRANSITION_DONE[transition] };
}
