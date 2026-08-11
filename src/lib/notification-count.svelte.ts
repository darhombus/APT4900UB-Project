/**
 * Shared unread-NOTIFICATION count, held outside the SvelteKit load/invalidate
 * pipeline.
 *
 * A deliberate twin of $lib/unread-count.svelte (messages) rather than a shared
 * generic: the two counts have different sources, different Realtime triggers
 * and different badges, and folding them into one store would couple a bell to a
 * conversation.
 *
 * The reason for the pattern is recorded on the messaging side and applies
 * unchanged here (NTF-18): the root layout seeds this from its SSR value, and
 * live updates write to it directly via a cheap `/api/notification-count` fetch.
 * Routing that through `invalidate()` would re-run the whole root layout —
 * profile query, category tree, auth revalidation — to change one number, which
 * is what once made the app feel like it hung.
 */
let count = $state(0);

export const notificationCount = {
	get value() {
		return count;
	},
	set(n: number) {
		count = Math.max(0, n);
	}
};
