import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';

export const LISTING_IMAGES_BUCKET = 'listing-images';

/** Pure: the canonical storage object path — {seller_id}/{listing_id}/{uuid}.webp. */
export function buildImagePath(sellerId: string, listingId: string, uuid: string): string {
	return `${sellerId}/${listingId}/${uuid}.webp`;
}

/** Pure: the public URL for a storage path, given the Supabase project URL. */
export function publicUrlFrom(supabaseUrl: string, storagePath: string): string {
	return `${supabaseUrl}/storage/v1/object/public/${LISTING_IMAGES_BUCKET}/${storagePath}`;
}

type ImageLike = { storage_path: string; position: number };

/** Pure: the cover image's storage_path (lowest position) or null when there are none. */
export function coverPath(images: ImageLike[] | null | undefined): string | null {
	if (!images || images.length === 0) return null;
	return images.reduce((lowest, img) => (img.position < lowest.position ? img : lowest))
		.storage_path;
}

/**
 * A theme-neutral inline placeholder for listings with no photo. Inline SVG so it
 * needs no network round-trip and never 404s; colours match the MySoko neutrals.
 */
export const PLACEHOLDER_IMAGE =
	'data:image/svg+xml,' +
	encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">` +
			`<rect width="400" height="300" fill="#eff1f0"/>` +
			`<g stroke="#b9c0c0" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
			`<rect x="140" y="108" width="120" height="92" rx="10"/>` +
			`<circle cx="172" cy="140" r="11"/>` +
			`<path d="M148 196 l34 -34 22 20 26 -30 26 44"/>` +
			`</g></svg>`
	);

/**
 * The public URL for a stored listing image. Uses the Supabase client (which knows
 * the project URL) so this module stays env-free and unit-testable; works both
 * server-side (locals.supabase) and in the browser.
 */
export function publicUrl(supabase: SupabaseClient<Database>, storagePath: string): string {
	return supabase.storage.from(LISTING_IMAGES_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

/** The cover image URL for a listing (its lowest-position image) or the placeholder. */
export function getCoverUrl(
	supabase: SupabaseClient<Database>,
	listing: { listing_images?: ImageLike[] | null }
): string {
	const path = coverPath(listing.listing_images);
	return path ? publicUrl(supabase, path) : PLACEHOLDER_IMAGE;
}
