import { json } from '@sveltejs/kit';
import { unreadConversationCount } from '$lib/server/messaging';
import type { RequestHandler } from './$types';

/**
 * Just the unread-conversation count, for the header badge's live refresh.
 * Deliberately its own tiny endpoint rather than routed through the root
 * layout's `depends('app:unread')`: invalidating the layout load re-ran the
 * profile + category-tree queries too and pushed a new merged `data` object
 * to every mounted route on the page for every incoming message, which is
 * what made the whole app feel like it hung during an active conversation.
 */
export const GET: RequestHandler = async ({ locals: { supabase, user } }) => {
	if (!user) return json({ count: 0 });
	const count = await unreadConversationCount(supabase, user.id).catch(() => 0);
	return json({ count });
};
