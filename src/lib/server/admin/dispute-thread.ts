import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import type { ThreadMessage } from '$lib/messaging';

type DB = SupabaseClient<Database>;

/**
 * ⚠️ ADMIN-ONLY READERS. Platform-wide by design (ADM-38).
 *
 * THE PATH IS THE WARNING. These live under `server/admin/` rather than
 * alongside the participant readers in `server/messaging.ts` precisely so a
 * wrong call site is unmissable in an import line, the way
 * `admin_read_private_profile` reads as admin-only at every use.
 *
 * WHY THEY EXIST. ADM-36 scoped every participant read to the participant, and
 * that correctly took `/admin` with it: `/admin/disputes/[id]` linked into
 * `/messages/<id>`, which now 404s for an admin. Reading the disputed thread is
 * core moderation work, and ADM-23 forbids blinding `/admin`, so the capability
 * comes back — as its own admin-scoped path, not by widening the participant one.
 *
 * WHAT AUTHORISES THEM. Nothing in this file. They read through the existing
 * `is_admin()` arms on `conversations_select` and `messages_select` (BST-22),
 * which admit any admin to any row. The ONLY thing standing between these
 * functions and a platform-wide read is the route guard at
 * `(protected)/admin/+layout.server.ts` — `requireRole(..., ['admin'],
 * { hide: true })` — which every route under /admin inherits. Calling either
 * function from anywhere outside /admin removes that guard and leaks the
 * platform. Do not.
 *
 * ADM-37 STANDS: no policy is changed to make this work, and none may be.
 *
 * NOTE WHAT IS DELIBERATELY ABSENT. There is no `adminReadConversation(id)`
 * here. A reader that takes an arbitrary conversation id is a function whose
 * only argument is the thing an admin must not choose freely — an admin editing
 * the id in the URL would read a thread unrelated to any dispute. The lookup
 * below is derived from the DISPUTE instead, so the dispute is the
 * authorisation and there is no by-id entry point to misuse.
 *
 * READ-ONLY. Neither function writes, and no write helper belongs in this file.
 * An admin reading a thread must not mutate it — that is ADM-17's operative line,
 * and `markRead` on a stranger's thread would be exactly the mutation it forbids.
 */

export interface DisputeConversation {
	id: string;
	listingId: string;
	buyerId: string;
	sellerId: string;
}

/**
 * The thread a dispute concerns, resolved from the dispute's ORDER — never from
 * a caller-supplied conversation id.
 *
 * `(listing_id, buyer_id)` is unique on `conversations`, and it is the same pair
 * `admin/disputes/[id]/+page.server.ts` already uses to decide whether to offer
 * the link at all, so both surfaces resolve the identical thread by
 * construction rather than by agreement.
 */
export async function adminFindDisputeConversation(
	supabase: DB,
	listingId: string,
	buyerId: string
): Promise<DisputeConversation | null> {
	const { data } = await supabase
		.from('conversations')
		.select('id, listing_id, buyer_id, seller_id')
		.eq('listing_id', listingId)
		.eq('buyer_id', buyerId)
		.maybeSingle();

	if (!data) return null;
	return {
		id: data.id,
		listingId: data.listing_id,
		buyerId: data.buyer_id,
		sellerId: data.seller_id
	};
}

/**
 * Every message in one conversation, oldest-first, unscoped by participation.
 *
 * The caller must have obtained `conversationId` from
 * `adminFindDisputeConversation` — that is what ties the read to a dispute. This
 * function itself trusts its argument and the /admin guard above it.
 */
export async function adminReadConversationMessages(
	supabase: DB,
	conversationId: string
): Promise<ThreadMessage[]> {
	const { data } = await supabase
		.from('messages')
		.select('id, sender_id, body, created_at')
		.eq('conversation_id', conversationId)
		.order('created_at', { ascending: true });

	return data ?? [];
}
