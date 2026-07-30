import { env as dynamicEnv } from '$env/dynamic/private';

/**
 * ⚠️ SERVER-ONLY. Runtime-read environment variables (R-4).
 *
 * These are read through `$env/dynamic/private` rather than the static schema in
 * `env.ts`, so no Vercel scope gains a build-time requirement for them — a
 * static import of a variable that is unset in any scope fails that scope's
 * build outright, which is the failure this avoids. Everything here is optional
 * with an in-code default.
 *
 * The `process.env` fallback covers runtimes where the virtual module snapshots
 * at import time (Vitest, one-off scripts).
 */
export function readRuntimeEnv(name: string): string | undefined {
	return dynamicEnv[name] ?? process.env[name];
}

/** D3's hold window, in minutes. Tests set it low; unset means 30. */
export const DEFAULT_ORDER_HOLD_MINUTES = 30;

/**
 * How long a pending order holds its listing before Inngest expires it.
 *
 * `ORDER_HOLD_MINUTES` exists for local testing — the e2e sets it to 1 so the
 * expiry is observable inside a test run instead of half an hour later. It must
 * stay UNSET on every Vercel tier (Section 11's checklist asserts that), so
 * production always uses the 30-minute default.
 *
 * Fractions are accepted so a fast local run can use e.g. 0.25; anything
 * non-numeric or non-positive falls back to the default rather than producing a
 * zero-length hold, which would expire orders the instant they were created.
 */
export function orderHoldMinutes(): number {
	const raw = readRuntimeEnv('ORDER_HOLD_MINUTES');
	if (raw === undefined || raw.trim() === '') return DEFAULT_ORDER_HOLD_MINUTES;

	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		console.warn(
			'[checkout] ignoring ORDER_HOLD_MINUTES=%s (not a positive number); using %d',
			raw,
			DEFAULT_ORDER_HOLD_MINUTES
		);
		return DEFAULT_ORDER_HOLD_MINUTES;
	}
	return parsed;
}

/**
 * The hold window as an Inngest duration string. Sub-minute values become
 * seconds so a fast local run doesn't have to wait out a whole minute.
 */
export function orderHoldDuration(): string {
	const minutes = orderHoldMinutes();
	if (minutes >= 1) return `${minutes}m`;
	return `${Math.max(1, Math.round(minutes * 60))}s`;
}
