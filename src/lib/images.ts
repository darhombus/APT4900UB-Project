// Client-side image processing for listing photos. Validation and geometry are
// pure functions (unit-tested); the canvas encode runs only in the browser.

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB raw, before compression
export const MAX_IMAGE_EDGE = 1600; // longest edge (px) after downscale
export const WEBP_QUALITY = 0.8;
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const MB = 1024 * 1024;

export type ImageValidation = { ok: true } | { ok: false; error: string };

/** Pure: is the picked file an accepted image within the raw size limit? */
export function validateImageFile(file: Pick<File, 'type' | 'size'>): ImageValidation {
	if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
		return { ok: false, error: 'Choose a JPEG, PNG, or WebP image.' };
	}
	if (file.size > MAX_IMAGE_BYTES) {
		return { ok: false, error: `Image must be ${Math.round(MAX_IMAGE_BYTES / MB)} MB or smaller.` };
	}
	return { ok: true };
}

/**
 * Pure: the dimensions after fitting the longest edge to `maxEdge`, preserving
 * aspect ratio. Never upscales (small images pass through unchanged).
 */
export function scaledDimensions(
	width: number,
	height: number,
	maxEdge = MAX_IMAGE_EDGE
): { width: number; height: number } {
	const longest = Math.max(width, height);
	if (longest === 0 || longest <= maxEdge) return { width, height };
	const scale = maxEdge / longest;
	return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Browser-only: decode, downscale, and re-encode a file to WebP at quality 0.8.
 * Not unit-tested (needs a real canvas); the size/geometry it relies on is.
 */
export async function compressToWebp(file: File): Promise<Blob> {
	const bitmap = await createImageBitmap(file);
	const { width, height } = scaledDimensions(bitmap.width, bitmap.height);

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Your browser could not process this image.');
	ctx.drawImage(bitmap, 0, 0, width, height);
	bitmap.close?.();

	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY)
	);
	if (!blob) throw new Error('Your browser could not process this image.');
	return blob;
}
