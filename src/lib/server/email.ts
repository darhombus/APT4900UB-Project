import { Resend } from 'resend';
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
 * Send one email. THROWS on failure.
 *
 * Throwing is correct here and is not the same as failing the notification: the
 * caller runs this inside its own Inngest step (NTF-3 as amended), so a throw
 * buys a retry, and a terminal failure after retries is caught and logged by the
 * handler while the function still completes. The in-app row is already written
 * by then and is never rolled back.
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

	if (error) {
		// The message is the useful part — Resend names the reason ("domain is not
		// verified", "invalid recipient") in it, and those read very differently in
		// a log than a bare status code.
		throw new Error(`resend send failed (${error.name}): ${error.message}`);
	}

	return { id: data?.id ?? null };
}
