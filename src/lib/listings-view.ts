import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { getCoverUrl, coverPath } from '$lib/listing-images';

/**
 * A compact relative-time label ("3h ago", "2w ago"). Computed on the SERVER
 * (in load functions) and passed to the card as a string, so the value is
 * identical across SSR and hydration — computing it live in the component from
 * `Date.now()` would risk a hydration mismatch. Pure, so it's unit-tested.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
	const then = new Date(iso).getTime();
	const s = Math.max(0, Math.floor((now - then) / 1000));
	if (s < 60) return 'just now';
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	if (d < 7) return `${d}d ago`;
	const w = Math.floor(d / 7);
	if (w < 5) return `${w}w ago`;
	const mo = Math.floor(d / 30);
	if (mo < 12) return `${mo}mo ago`;
	return `${Math.floor(d / 365)}y ago`;
}

/** The fields a ListingCard needs, flattened from a listings row + its images. */
export interface ListingCardData {
	id: string;
	title: string;
	price: number | string;
	location_area: string | null;
	condition: string | null;
	coverUrl: string;
	postedLabel: string;
	/** True for Small Services listings; drives the photo-less service card variant. */
	isService: boolean;
	/** Whether the listing has at least one photo. */
	hasImage: boolean;
	/** Subcategory name, shown as the label on the service-card variant. */
	categoryLabel: string | null;
}

type CardListing = {
	id: string;
	title: string;
	price: number | string;
	location_area: string | null;
	condition: string | null;
	published_at: string | null;
	created_at: string;
	listing_images?: { storage_path: string; position: number }[] | null;
	/** listing_type from the row; 'service' selects the service-card variant. */
	type?: string | null;
	/** Pre-resolved subcategory name (the loads resolve it from the category tree). */
	categoryLabel?: string | null;
};

/** Map a listings row (with its embedded images) to the card view-model. */
export function toCardData(
	supabase: SupabaseClient<Database>,
	listing: CardListing,
	now?: number
): ListingCardData {
	return {
		id: listing.id,
		title: listing.title,
		price: listing.price,
		location_area: listing.location_area,
		condition: listing.condition,
		coverUrl: getCoverUrl(supabase, listing),
		postedLabel: relativeTime(listing.published_at ?? listing.created_at, now),
		isService: listing.type === 'service',
		hasImage: coverPath(listing.listing_images) !== null,
		categoryLabel: listing.categoryLabel ?? null
	};
}
