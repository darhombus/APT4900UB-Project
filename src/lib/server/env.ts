/**
 * Centralised, typed environment access.
 *
 * ⚠️ SERVER-ONLY. This module imports from `$env/static/private`, so it must
 * never be imported into browser code. SvelteKit enforces this at build time:
 * anything under `src/lib/server/` (and `$env/static/private`) is unreachable
 * from the client. Client code must read PUBLIC_ values directly from
 * `$env/static/public` — never from here.
 *
 * Importing this module validates the required (Supabase) variables and throws
 * a clear, named error if any is missing, so the app fails fast at startup
 * rather than deep inside a request.
 */
import {
	PUBLIC_SUPABASE_URL,
	PUBLIC_SUPABASE_ANON_KEY,
	PUBLIC_PAYSTACK_PUBLIC_KEY,
	PUBLIC_APP_URL
} from '$env/static/public';
import {
	SUPABASE_SERVICE_ROLE_KEY,
	PAYSTACK_SECRET_KEY,
	INNGEST_EVENT_KEY,
	INNGEST_SIGNING_KEY,
	AT_API_KEY,
	AT_USERNAME,
	RESEND_API_KEY
} from '$env/static/private';

/**
 * Returns `value` if it is a non-empty string, otherwise throws a clear error
 * naming the missing variable.
 */
function required(name: string, value: string | undefined): string {
	if (value === undefined || value.trim() === '') {
		throw new Error(
			`Missing required environment variable: ${name}. ` +
				`Add it to your .env (see .env.example). The Supabase values are ` +
				`printed by \`supabase start\` (Section 4); in Vercel they live in the ` +
				`project's Environment Variables.`
		);
	}
	return value;
}

export const env = {
	// ── Supabase — REQUIRED in every environment ──────────────────────────────
	PUBLIC_SUPABASE_URL: required('PUBLIC_SUPABASE_URL', PUBLIC_SUPABASE_URL),
	PUBLIC_SUPABASE_ANON_KEY: required('PUBLIC_SUPABASE_ANON_KEY', PUBLIC_SUPABASE_ANON_KEY),
	SUPABASE_SERVICE_ROLE_KEY: required('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY),

	// ── App ───────────────────────────────────────────────────────────────────
	PUBLIC_APP_URL: PUBLIC_APP_URL?.trim() ? PUBLIC_APP_URL : 'http://localhost:5173',

	// ── Email — REQUIRED from the notifications phase (NTF-8) ─────────────────
	// Promoted out of the optional block below, per the TODO that block carried:
	// the notifications phase is the one that sends mail, and a tier running
	// without this key would create in-app notifications while silently failing
	// every email — the failure would be visible only in Inngest run logs. Fail
	// at startup instead.
	//
	// The sender address is deliberately NOT here: it is a code constant in
	// $lib/server/email, so shipping email adds no new variable to any Vercel
	// scope (a scope missing one fails the build outright).
	RESEND_API_KEY: required('RESEND_API_KEY', RESEND_API_KEY),

	// ── Third-party — OPTIONAL for now ────────────────────────────────────────
	// TODO(sms-phase): promote AT_* to `required(...)` if SMS ships. Paystack and
	// Inngest are already present on every tier; they stay optional here only
	// because the local stack runs without them.
	PUBLIC_PAYSTACK_PUBLIC_KEY,
	PAYSTACK_SECRET_KEY,
	INNGEST_EVENT_KEY,
	INNGEST_SIGNING_KEY,
	AT_API_KEY,
	AT_USERNAME
} as const;
