import { Resend, type ErrorResponse } from 'resend';
import { env } from '$lib/server/env';

/**
 * ⚠️ SERVER-ONLY. The Resend client and the one function that sends mail
 * (Notifications PRD — Section 4; NTF-8).
 *
 * Thin on purpose. Everything that decides WHAT to send lives in
 * $lib/server/notifications (routing) and $lib/server/email-templates
 * (rendering); this module only knows how to hand finished bytes to Resend and
 * how to describe a failure.
 */

/**
 * The sender, as a code constant rather than an env var (NTF-8).
 *
 * A new variable in $lib/server/env would have to exist in every Vercel scope
 * before the next build could succeed — env.ts static-imports its variables, so
 * a scope missing one fails the build outright rather than degrading. That cost
 * buys nothing here: the address is not a secret and changes at most once, when
 * the domain is verified.
 *
 * `onboarding@resend.dev` is Resend's shared test-domain sender. It works
 * without any DNS setup and CANNOT deliver to anyone but the account's own
 * verified address — every other recipient is rejected by Resend, not by us.
 * That limitation is an ops item, recorded in the local project notes;
 * changing this line is the whole of the code change when the domain is ready.
 */
export const EMAIL_FROM = 'MySoko <onboarding@resend.dev>';

let client: Resend | null = null;

/**
 * Lazily constructed so that importing this module does not require the key.
 *
 * The tests import the templates and the routing without ever sending, and the
 * local dev server runs with no Resend key at all; constructing at module scope
 * would make both of those a startup error.
 */
function getClient(): Resend {
	if (!client) {
		client = new Resend(env.RESEND_API_KEY);
	}
	return client;
}

/**
 * Resend error codes that mean THIS MESSAGE can never be delivered, however
 * many times it is retried (NTF-3, second amendment).
 *
 * The list is deliberately narrow — "the address or the payload is wrong" —
 * because everything absent from it retries, and retrying is the safe default.
 * `validation_error` is the one that matters most in practice today: it is what
 * Resend returns for the unverified-test-domain rejection ("you can only send
 * testing emails to your own address"), which is EVERY recipient but the
 * operator's until a domain is verified.
 *
 * WHAT IS DELIBERATELY ABSENT, AND WHY. The API-key codes —
 * `missing_api_key`, `invalid_api_key`, `restricted_api_key` — are equally
 * unfixable by retrying, and are equally NOT undeliverable-address failures.
 * They mean the whole channel is dead, and this project has already lost
 * production hours to a credential that failed silently (the [SENSITIVE]
 * outage). Letting them retry to exhaustion turns a dead key into a red run,
 * which is precisely the alarm that was missing then. Quota and rate-limit
 * codes are absent for the ordinary reason: they come right on their own.
 */
const UNDELIVERABLE_CODES: ReadonlySet<string> = new Set<ErrorResponse['name']>([
	'validation_error',
	'invalid_parameter',
	'invalid_from_address',
	'missing_required_field',
	'invalid_attachment',
	'not_found',
	'invalid_idempotency_key',
	'invalid_idempotent_request'
]);

/** True when Resend's refusal is about the message, not about our ability to send. */
export function isUndeliverableCode(code: string): boolean {
	return UNDELIVERABLE_CODES.has(code);
}

/**
 * A Resend refusal, carrying the classification the caller routes on.
 *
 * `undeliverable` is computed once, here, rather than at each call site: the
 * decision is a property of the error and must not be able to differ between
 * two handlers reading the same failure.
 */
export class EmailSendError extends Error {
	readonly code: string;
	readonly statusCode: number | null;
	readonly undeliverable: boolean;

	constructor(error: ErrorResponse) {
		super(`resend send failed (${error.name}): ${error.message}`);
		this.name = 'EmailSendError';
		this.code = error.name;
		this.statusCode = error.statusCode;
		this.undeliverable = isUndeliverableCode(error.name);
	}
}

export interface SendEmailInput {
	to: string;
	subject: string;
	html: string;
	text: string;
	/**
	 * Mirrors the in-app dedupe key (NTF-8). Resend collapses repeated sends
	 * carrying the same key, so a retried Inngest step cannot double-send even
	 * though it will genuinely call this function twice.
	 */
	idempotencyKey: string;
}

/**
 * Send one email. THROWS `EmailSendError` on a Resend refusal.
 *
 * The caller decides what a throw means, using `undeliverable` (NTF-3, second
 * amendment): an undeliverable message is converted to a structured "skipped"
 * outcome so the step completes green and burns no retries, while anything else
 * is rethrown and retried honestly. This module does not make that call itself,
 * because the same failure means different things to a transactional receipt and
 * to a nightly digest — but it does classify it, so the two cannot disagree.
 *
 * Resend reports failures in the response body rather than by rejecting, so the
 * `error` field has to be checked explicitly — a bare `await` would treat a
 * rejected recipient as a success.
 */
export async function sendEmail(input: SendEmailInput): Promise<{ id: string | null }> {
	const { data, error } = await getClient().emails.send(
		{
			from: EMAIL_FROM,
			to: input.to,
			subject: input.subject,
			html: input.html,
			text: input.text
		},
		{ idempotencyKey: input.idempotencyKey }
	);

	// The message is the useful part — Resend names the reason ("domain is not
	// verified", "invalid recipient") in it, and those read very differently in a
	// log than a bare status code. EmailSendError keeps it and adds the routing
	// classification.
	if (error) throw new EmailSendError(error);

	return { id: data?.id ?? null };
}
