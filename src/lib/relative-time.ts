/**
 * A compact relative timestamp for conversation rows. Computed server-side (in the
 * load) and passed to the client as a finished string, so server and client render
 * the same label — no hydration mismatch (the auth-phase hydration rule). Recent
 * times read as "just now / 5m / 2h / 3d"; anything a week or older falls back to a
 * short absolute date. `now` is injectable for deterministic tests.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
	const diff = now - new Date(iso).getTime();

	const MIN = 60_000;
	const HOUR = 60 * MIN;
	const DAY = 24 * HOUR;
	const WEEK = 7 * DAY;

	// diff < MIN also covers small negative diffs from clock skew → "just now".
	if (diff < MIN) return 'just now';
	if (diff < HOUR) return `${Math.floor(diff / MIN)}m`;
	if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
	if (diff < WEEK) return `${Math.floor(diff / DAY)}d`;

	const d = new Date(iso);
	const sameYear = new Date(now).getFullYear() === d.getFullYear();
	return new Intl.DateTimeFormat('en-KE', {
		day: 'numeric',
		month: 'short',
		...(sameYear ? {} : { year: 'numeric' })
	}).format(d);
}

// Thread timestamps are pinned to East Africa Time (the marketplace is
// Nairobi-focused). A FIXED timezone makes formatting deterministic regardless of
// where it runs, so the server (SSR, often UTC) and the browser produce identical
// strings — no hydration mismatch — and history + live messages read the same way.
const EAT = 'Africa/Nairobi';
const timeFmt = new Intl.DateTimeFormat('en-KE', {
	timeZone: EAT,
	hour: '2-digit',
	minute: '2-digit',
	hour12: false
});
const dayFmt = new Intl.DateTimeFormat('en-KE', { timeZone: EAT, day: 'numeric', month: 'short' });

/** A message's clock time in EAT, e.g. "15:45". */
export function messageTime(iso: string): string {
	return timeFmt.format(new Date(iso));
}

/** A message's day in EAT for day dividers, e.g. "12 Jul". */
export function messageDay(iso: string): string {
	return dayFmt.format(new Date(iso));
}
