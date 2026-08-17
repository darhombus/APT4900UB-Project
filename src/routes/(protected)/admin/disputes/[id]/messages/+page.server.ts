import { error } from '@sveltejs/kit';
import {
	adminFindDisputeConversation,
	adminReadConversationMessages
} from '$lib/server/admin/dispute-thread';
import type { PageServerLoad } from './$types';

/**
 * The thread a dispute concerns, for the admin deciding it (ADM-38).
 *
 * AUTHORISED BY THE ROUTE, NOT BY THE QUERY. This sits under /admin, so
 * `(protected)/admin/+layout.server.ts` runs first and calls
 * `requireRole(..., ['admin'], { hide: true })` — a non-admin gets 404, not 403,
 * and never reaches this load. Nested routes inherit that layout guard; there is
 * no layout between it and here. That guard is the only thing authorising the
 * platform-wide reads below.
 *
 * THE DISPUTE IS THE SCOPE, NOT THE URL. The conversation is resolved from the
 * dispute's order — `(listing_id, buyer_id)` — and never from a parameter. The
 * route is /admin/disputes/<disputeId>/messages, so the only id an admin can
 * edit selects a DISPUTE, and reaching a thread still requires a dispute that
 * points at it. Taking a conversation id here instead would let an admin read
 * any thread on the platform by typing one, which is precisely the capability
 * ADM-36 removed and which ADM-38 is not reinstating. An admin may read the
 * thread a dispute is about; that is the whole of it.
 *
 * READ-ONLY. No form actions, no markRead, no write of any kind — an admin
 * reading a thread must not mutate it (ADM-17). Opening this page leaves the
 * conversation's unread state exactly as the participants left it.
 */
export const load: PageServerLoad = async ({ locals: { supabase }, params }) => {
	const { data: dispute } = await supabase
		.from('disputes')
		.select('id, order_id, status')
		.eq('id', params.id)
		.maybeSingle();
	if (!dispute) error(404, 'Not found');

	const { data: order } = await supabase
		.from('orders')
		.select('id, listing_id, buyer_id, seller_id')
		.eq('id', dispute.order_id)
		.maybeSingle();
	if (!order) error(404, 'Not found');

	const conversation = await adminFindDisputeConversation(
		supabase,
		order.listing_id,
		order.buyer_id
	);
	// No thread between these two on this listing. The dispute page only offers
	// the link when one exists, so this is a stale link or a typed URL, not a
	// state the UI produces.
	if (!conversation) error(404, 'Not found');

	const [messages, { data: parties }, { data: listing }] = await Promise.all([
		adminReadConversationMessages(supabase, conversation.id),
		// profiles_select is `using (true)` for everyone — no admin arm involved.
		supabase.from('profiles').select('id, full_name').in('id', [order.buyer_id, order.seller_id]),
		supabase.from('listings').select('id, title').eq('id', order.listing_id).maybeSingle()
	]);

	const byId = new Map((parties ?? []).map((p) => [p.id, p.full_name]));

	return {
		disputeId: dispute.id,
		listingTitle: listing?.title ?? 'Listing unavailable',
		buyer: { id: order.buyer_id, name: byId.get(order.buyer_id) ?? 'Buyer' },
		seller: { id: order.seller_id, name: byId.get(order.seller_id) ?? 'Seller' },
		messages
	};
};
