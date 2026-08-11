import { json } from '@sveltejs/kit';
import { unreadNotificationCount } from '$lib/server/notifications';
import type { RequestHandler } from './$types';

/**
 * Just the unread-notification count, for the bell badge's live refresh.
 *
 * Its own tiny endpoint, exactly like /api/unread-count and for the same
 * recorded reason (NTF-18): routing this through the root layout's load would
 * re-run the profile and category-tree queries and push a new merged `data`
 * object to every mounted route for every incoming notification.
 *
 * Failures degrade to 0 rather than 500ing: a badge is not worth an error, and
 * the count is re-fetched on the next navigation anyway.
 */
export const GET: RequestHandler = async ({ locals: { supabase, user } }) => {
	if (!user) return json({ count: 0 });
	const count = await unreadNotificationCount(supabase).catch(() => 0);
	return json({ count });
};
