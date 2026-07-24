/**
 * Shared unread-conversation count, held outside the SvelteKit load/invalidate
 * pipeline. The root layout seeds it from the SSR value; the live badge
 * subscription and the thread view's mark-read flow update it directly via a
 * cheap `/api/unread-count` fetch, so a message arriving doesn't force a full
 * root-layout reload (profile + category tree + auth revalidation) just to
 * change one number.
 */
let count = $state(0);

export const unreadCount = {
	get value() {
		return count;
	},
	set(n: number) {
		count = Math.max(0, n);
	}
};
