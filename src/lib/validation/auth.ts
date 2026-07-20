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

export const signupSchema = z.object({
	fullName: z.string().trim().min(2, 'Enter your full name').max(120, 'Name is too long'),
	email: z.email('Enter a valid email address'),
	phone,
	password
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

/** The Supabase auth error shape we read, kept structural so this stays pure/testable. */
type AuthErrorLike = { message?: string | null; code?: string | null; status?: number | null };

/** True when a raw error message is unfit to show a user (empty, or object/JSON-ish). */
function isUnhelpfulMessage(message: string): boolean {
	const m = message.trim();
	return (
		m === '' || m === '{}' || m === '[object Object]' || m.startsWith('{') || m.startsWith('[')
	);
}

/**
 * Turn a Supabase auth error into copy that is always safe to show a user.
 * Supabase can return errors whose `.message` is empty or a non-human value — on
 * the hosted stack an opaque error body surfaced as "{}" and rendered verbatim in
 * the signup error box. This maps the common, actionable cases and, crucially,
 * NEVER returns "{}" / "[object Object]" / a raw empty string: anything
 * unrecognised falls back to a friendly generic.
 */
export function friendlyAuthError(error: AuthErrorLike): string {
	const code = error.code ?? '';
	const status = error.status ?? 0;

	if (code === 'user_already_exists' || code === 'email_exists') {
		return 'That email is already registered. Try logging in instead.';
	}
	if (code === 'weak_password') {
		return 'Please choose a stronger password (at least 8 characters).';
	}
	if (
		status === 429 ||
		code === 'over_email_send_rate_limit' ||
		code === 'over_request_rate_limit'
	) {
		return 'Too many attempts. Please wait a minute and try again.';
	}
	if (code === 'email_address_invalid') {
		return 'That email address looks invalid. Please check it and try again.';
	}
	// 5xx / unexpected failures are typically email-delivery or server-side issues,
	// not something the user typed wrong.
	if (status >= 500 || code === 'unexpected_failure' || code === 'email_send_failed') {
		return "We couldn't send your verification email just now — please try again shortly.";
	}

	const message = (error.message ?? '').trim();
	return isUnhelpfulMessage(message)
		? 'Something went wrong creating your account. Please try again.'
		: message;
}
