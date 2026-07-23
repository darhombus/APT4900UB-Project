import { z } from 'zod';

/**
 * Message body validation, shared by the client (progressive-enhancement hints)
 * and the server action (authoritative). Pure and unit-testable — no `$env`, no
 * Supabase client.
 *
 * Mirrors the ACTUAL database constraint (20260721150000_messaging_schema.sql):
 *   CHECK char_length(btrim(body)) between 1 and 2000
 * i.e. the *trimmed* length must be 1–2000. Leading/trailing whitespace is
 * stripped before both validation and storage.
 */

export const MESSAGE_MIN = 1;
export const MESSAGE_MAX = 2000;

export const messageBodySchema = z
	.string()
	.transform((s) => s.trim())
	.pipe(
		z
			.string()
			.min(MESSAGE_MIN, 'Type a message before sending.')
			.max(MESSAGE_MAX, `Messages can't be longer than ${MESSAGE_MAX} characters.`)
	);

export type MessageBodyResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * Validate + normalise a raw message body. Returns the trimmed value on success
 * or a single human-readable error suitable for a toast / form error.
 */
export function validateMessageBody(raw: unknown): MessageBodyResult {
	const parsed = messageBodySchema.safeParse(typeof raw === 'string' ? raw : '');
	if (!parsed.success) {
		return { ok: false, error: parsed.error.issues[0]?.message ?? 'Enter a valid message.' };
	}
	return { ok: true, value: parsed.data };
}
