import { fail, redirect } from '@sveltejs/kit';
import { listNotifications } from '$lib/server/notifications';
import {
	isNotificationType,
	notificationCopy,
	notificationHref,
	notificationIcon,
	type NotificationPayload
} from '$lib/notifications';
import { relativeTime } from '$lib/relative-time';
import type { Actions, PageServerLoad } from './$types';

/**
 * The notification inbox (Notifications PRD — Section 6.2).
 *
 * Lives under (protected), so the group's auth guard covers it — no check here.
 *
 * Every row is rendered to finished strings IN THE LOAD, including the relative
 * timestamp. That is the standing hydration rule this app follows for
 * conversation rows and for the same reason: a timestamp computed in the browser
 * disagrees with the one rendered on the server, and Svelte reports the mismatch
 * by silently discarding the server's markup.
 */
export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const rows = await listNotifications(supabase);
	const now = Date.now();

	const notifications = rows.flatMap((row) => {
		// A type the app does not know about cannot be rendered, and rendering it
		// blank would be worse than omitting it. Unreachable while the CHECK
		// constraint and NOTIFICATION_TYPES agree — this is what catches them
		// disagreeing, which is exactly the kind of drift a deploy can introduce.
		if (!isNotificationType(row.type)) return [];

		const payload = (row.payload ?? {}) as NotificationPayload;
		const copy = notificationCopy(row.type, payload);

		return [
			{
				id: row.id,
				type: row.type,
				title: copy.title,
				body: copy.body,
				href: notificationHref(row.type, payload),
				icon: notificationIcon(row.type),
				unread: row.read_at === null,
				createdAt: row.created_at,
				age: relativeTime(row.created_at, now)
			}
		];
	});

	return { notifications, unreadCount: notifications.filter((n) => n.unread).length };
};

export const actions: Actions = {
	/**
	 * Mark one notification read, then follow it to its source.
	 *
	 * A form action rather than a fetch: it works before hydration and without
	 * JavaScript, and the progressive-enhancement path in the page turns it into
	 * an optimistic update. `markRead` returns false for an already-read row —
	 * a normal outcome, not an error, so it is not checked.
	 */
	markRead: async ({ request, locals: { supabase } }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { markError: 'That notification could not be opened.' });

		// The RPC is the ONLY write path — `authenticated` holds no UPDATE grant on
		// notifications, of any width (NTF-6). A `false` return means "already read"
		// or "not yours", both normal, so only a transport error is checked.
		const { error } = await supabase.rpc('mark_notification_read', { p_notification_id: id });
		if (error) return fail(400, { markError: 'That notification could not be opened.' });

		// THE DESTINATION IS COMPUTED HERE, FROM THE ROW — never taken from the
		// form. A `to` field would be an open redirect: anyone could hand a logged-in
		// user a form posting to this action with an off-site destination. Reading it
		// back through the caller's client also means own-row RLS decides what can be
		// followed, so a guessed id resolves to nothing rather than to someone else's
		// order page.
		const { data: row } = await supabase
			.from('notifications')
			.select('type, payload')
			.eq('id', id)
			.maybeSingle();

		if (row && isNotificationType(row.type)) {
			redirect(303, notificationHref(row.type, (row.payload ?? {}) as NotificationPayload));
		}

		// The row is gone, or carries a type this build does not know. Staying put
		// is the honest outcome — the list re-renders with it marked read.
		return { marked: true };
	},

	markAllRead: async ({ locals: { supabase } }) => {
		const { error } = await supabase.rpc('mark_all_notifications_read');
		if (error) return fail(400, { markError: 'Those notifications could not be marked as read.' });

		return { markedAll: true };
	}
};
