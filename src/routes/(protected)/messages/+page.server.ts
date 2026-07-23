import { redirect } from '@sveltejs/kit';
import { listConversations } from '$lib/server/messaging';
import { relativeTime } from '$lib/relative-time';
import type { PageServerLoad } from './$types';

/**
 * The conversation list. The `(protected)` group already redirects logged-out
 * visitors to /login with a return path; the guard here narrows the type and keeps
 * the return path explicit. Relative timestamps are formatted server-side so the
 * SSR and hydrated markup match (no hydration mismatch).
 */
export const load: PageServerLoad = async ({ locals: { supabase, user } }) => {
	if (!user) redirect(303, '/login?redirectTo=/messages');

	const conversations = await listConversations(supabase, user.id);
	const now = Date.now();

	return {
		conversations: conversations.map((c) => ({
			...c,
			timeLabel: relativeTime(c.lastMessageAt, now)
		}))
	};
};
