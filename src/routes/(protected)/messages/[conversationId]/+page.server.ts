import { error, fail, redirect } from '@sveltejs/kit';
import { getConversation, listMessages, markRead, sendMessage } from '$lib/server/messaging';
import type { Actions, PageServerLoad } from './$types';

/**
 * Thread view load. The `(protected)` group already guaranteed an authenticated
 * user. getConversation returns null for a non-participant, which we surface as a
 * 404 (not a 403) so conversation ids aren't enumerable (Section 5). Opening the
 * thread marks it read for the caller (best-effort).
 */
export const load: PageServerLoad = async ({ params, locals: { supabase, user } }) => {
	if (!user) redirect(303, '/login');

	// These three are independent, so run them together instead of in series (the
	// old sequential chain was ~5 DB round-trips before the thread could render).
	// markRead is best-effort but still awaited here so it completes on serverless
	// (a fire-and-forget promise can be frozen after the response); it runs in
	// parallel, so it no longer adds to the critical path. A non-participant gets
	// null from getConversation (→ 404); listMessages/markRead are RLS-scoped and
	// simply no-op for them.
	const [conversation, messages] = await Promise.all([
		getConversation(supabase, user.id, params.conversationId),
		listMessages(supabase, params.conversationId),
		markRead(supabase, user.id, params.conversationId)
	]);
	if (!conversation) error(404, 'Conversation not found');

	return { conversation, messages, me: user.id };
};

export const actions: Actions = {
	// The composer posts here — a plain form action, so it works without JavaScript.
	send: async ({ params, request, locals: { supabase, user } }) => {
		if (!user) redirect(303, '/login');

		const form = await request.formData();
		const body = String(form.get('body') ?? '');

		const result = await sendMessage(supabase, user.id, params.conversationId, body);
		if (!result.ok) return fail(400, { formError: result.error, values: { body } });

		// Re-load the thread; the newest message is now at the bottom.
		redirect(303, `/messages/${params.conversationId}`);
	},

	// Fired from the client when a live message arrives while the thread is open, so
	// the badge/unread state stays honest without a full reload. Best-effort.
	markRead: async ({ params, locals: { supabase, user } }) => {
		if (user) await markRead(supabase, user.id, params.conversationId);
		return { ok: true };
	}
};
