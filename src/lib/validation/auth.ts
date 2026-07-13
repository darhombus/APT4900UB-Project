import { z } from 'zod';

/**
 * Kenyan phone normalization — pure, unit-testable helpers (see auth.test.ts).
 *
 * Accepts the common local and international forms and normalizes to the
 * canonical `+254XXXXXXXXX` shape that the profiles.phone CHECK constraint
 * enforces (`^\+254[17]\d{8}$`): a Safaricom/Airtel-style `7…` or `1…` subscriber
 * number. Returns null for anything that does not match, so callers can surface a
 * validation error.
 *
 *   0712345678      -> +254712345678
 *   0112345678      -> +254112345678
 *   +254712345678   -> +254712345678
 *   254712345678    -> +254712345678
 *   0712 345 678    -> +254712345678   (spaces/dashes are ignored)
 */
export function normalizeKenyanPhone(input: string): string | null {
	const cleaned = input.replace(/[\s-]/g, '');

	// Capture the 9-digit subscriber part (leading 7 or 1) from each accepted form.
	const local = cleaned.match(/^0([17]\d{8})$/); // 07.../01...
	const intlPlus = cleaned.match(/^\+254([17]\d{8})$/); // +2547.../+2541...
	const intlBare = cleaned.match(/^254([17]\d{8})$/); // 2547.../2541...

	const subscriber = (local ?? intlPlus ?? intlBare)?.[1];
	return subscriber ? `+254${subscriber}` : null;
}

/** True when `input` is a phone number we can normalize to the canonical form. */
export function isValidKenyanPhone(input: string): boolean {
	return normalizeKenyanPhone(input) !== null;
}

const PHONE_MESSAGE = 'Enter a valid Kenyan phone number, e.g. 0712345678';

/** A Zod field that validates and rewrites a phone to canonical `+254…` form. */
const phone = z
	.string()
	.trim()
	.transform((value, ctx) => {
		const normalized = normalizeKenyanPhone(value);
		if (!normalized) {
			ctx.addIssue({ code: 'custom', message: PHONE_MESSAGE });
			return z.NEVER;
		}
		return normalized;
	});

const password = z.string().min(8, 'Password must be at least 8 characters');

export const signupSchema = z
	.object({
		fullName: z
			.string()
			.trim()
			.min(2, 'Enter your full name')
			.max(120, 'Name is too long'),
		email: z.email('Enter a valid email address'),
		phone,
		password,
		confirmPassword: z.string()
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: 'Passwords do not match',
		path: ['confirmPassword']
	});

export const profileSchema = z.object({
	fullName: z.string().trim().min(2, 'Enter your full name').max(120, 'Name is too long'),
	phone,
	// Optional free-text; empty string is allowed and stored as null by the action.
	location: z.string().trim().max(120, 'Location is too long')
});

/** Avatar upload constraints, shared by the client preview and the server action. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB (matches the bucket limit)
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const AVATAR_EXT: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp'
};

export const loginSchema = z.object({
	email: z.email('Enter a valid email address'),
	password: z.string().min(1, 'Enter your password')
});

export const forgotPasswordSchema = z.object({
	email: z.email('Enter a valid email address')
});

export const resetPasswordSchema = z
	.object({
		password,
		confirmPassword: z.string()
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: 'Passwords do not match',
		path: ['confirmPassword']
	});

/**
 * Flatten a ZodError into a `{ field: firstMessage }` map for rendering
 * field-level errors. Nested paths are joined with dots; issues with no path
 * (e.g. cross-field refinements that didn't set one) land under `_form`.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
	const out: Record<string, string> = {};
	for (const issue of error.issues) {
		const key = issue.path.length ? issue.path.join('.') : '_form';
		out[key] ??= issue.message;
	}
	return out;
}
