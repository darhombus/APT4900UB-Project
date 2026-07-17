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
	type CategoryTree
} from '$lib/validation/listings';
import type { Database } from '$lib/types/database';

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

	// Resolve the target row: the edit route's param, or a new-page draft's hidden
	// id. Owner-only — the edit load already 404s strangers, but re-check so the
	// action is safe standalone and a forged hidden id can't hit another seller.
	const targetId = listingIdFromRoute ?? (field(formData, 'listingId') || null);
	let existing: ExistingListing | null = null;
	if (targetId) {
		const { data } = await supabase
			.from('listings')
			.select('id, seller_id, status, published_at')
			.eq('id', targetId)
			.maybeSingle();
		if (!data || data.seller_id !== sellerId) {
			if (listingIdFromRoute) error(404, 'Not found');
			return fail(400, {
				formError: 'That listing could not be found. Reload the page and try again.',
				values: raw
			});
		}
		existing = data;
	}

	// Field-level validation against the intent's schema.
	const schema = intent === 'publish' ? publishListingSchema : draftListingSchema;
	const parsed = schema.safeParse(raw);
	const errors: Record<string, string> = parsed.success ? {} : fieldErrors(parsed.error);

	// The category must resolve to a real subcategory (never a top-level one).
	const tree = (await loadCategoryTree(supabase)) as CategoryTree[];
	const match = raw.categoryId ? findSubcategory(tree, raw.categoryId) : null;
	if (!match) errors.categoryId ??= raw.categoryId ? 'Choose a subcategory' : 'Choose a category';

	const service = match ? isServiceTop(match.top) : false;

	// Condition is forced null for services and required for goods only at publish.
	let condition: ItemCondition | null = null;
	if (match && !service) {
		condition = parsed.success ? (parsed.data.condition ?? null) : null;
		if (intent === 'publish' && !condition) errors.condition ??= 'Choose the item condition';
	}

	if (!parsed.success || !match || Object.keys(errors).length > 0) {
		return fail(400, { errors, values: raw });
	}
	const data = parsed.data;

	// Publish rule: goods need at least one stored photo; services are exempt.
	if (intent === 'publish' && !service) {
		let count = 0;
		if (existing) {
			const { count: c } = await supabase
				.from('listing_images')
				.select('id', { count: 'exact', head: true })
				.eq('listing_id', existing.id);
			count = c ?? 0;
		}
		if (count < 1) {
			return fail(400, {
				errors: { images: 'Add at least one photo before publishing.' },
				values: raw
			});
		}
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
