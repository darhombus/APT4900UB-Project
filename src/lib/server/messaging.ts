import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { createSupabaseAdmin } from '$lib/server/supabase-admin';
import { coverPath, publicUrl } from '$lib/listing-images';
import {
	isConversationUnread,
	type ConversationListing,
	type ConversationListItem,
	type ConversationParty,
	type ConversationSummary,
	type ThreadMessage
} from '$lib/messaging';
import { validateMessageBody } from '$lib/validation/messages';

/**
 * Server-side messaging data layer (Messaging PRD — Section 3). All reads that
 * are scoped to the caller use the request's RLS-bound client (`locals.supabase`),
 * so participation is enforced by the policies from Section 2 — a non-participant
 * simply gets no rows.
 *
 * The one exception is the *listing metadata* shown on a conversation row/header:
 * D3 keeps a conversation readable forever, but `listings_select` hides
 * paused/removed/deleted listings from the non-owner buyer (and `deleted` from
 * everyone). So the listing's title/price/status/cover is fetched with the
 * service-role admin client — a deliberate, minimal read, scoped to listing ids
 * that came from the caller's own (already RLS-authorised) conversations.
 */

type DB = SupabaseClient<Database>;

type ConversationRow = Pick<
	Database['public']['Tables']['conversations']['Row'],
	| 'id'
	| 'listing_id'
	| 'buyer_id'
	| 'seller_id'
	| 'last_message_at'
	| 'buyer_last_read_at'
	| 'seller_last_read_at'
>;

const CONVERSATION_COLUMNS =
	'id, listing_id, buyer_id, seller_id, last_message_at, buyer_last_read_at, seller_last_read_at';

/**
 * ADM-36 — "the caller is one of this conversation's two parties", as a filter
 * the QUERY carries rather than something RLS is trusted to supply.
 *
 * WHY THIS EXISTS AT ALL. Every read below used to select without an owner
 * filter and let `conversations_select` do the scoping. That policy reads
 * `(buyer_id = auth.uid() OR seller_id = auth.uid() OR is_admin())`, so for a
 * buyer or a seller the predicate IS the filter and the code looked correct.
 * For an admin the third arm opened every conversation on the platform: the
 * inbox listed threads between strangers, and any thread could be opened by URL.
 * The read arms exist so /admin can see the platform (BST-22); a PARTICIPANT
 * surface reading through them is a containment failure, not a feature.
 *
 * The bug predates ADM-17 — ADM-29 only made it reachable, by keeping /messages
 * open to an admin while removing its nav entry.
 *
 * ADM-37: no policy is narrowed to fix this, and none may be.
 * `conversations_select` and `messages_select` keep their admin arms, because
 * /admin/disputes/[id] reads the thread pointer through exactly those arms.
 * The scoping belongs in the query, where the surface's own intent lives.
 *
 * `userId` is the id from the verified session (hooks.server.ts resolves it via
 * getClaims), never request input, so interpolating it into a PostgREST filter
 * introduces no injection surface.
 */
const participantFilter = (userId: string) =>
	`buyer_id.eq.${userId},seller_id.eq.${userId}` as const;

// ── Query helpers ───────────────────────────────────────────────────────────

/** Conversations for the user, newest activity first, with listing + counterpart + unread + preview. */
export async function listConversations(
	supabase: DB,
	userId: string
): Promise<ConversationListItem[]> {
	// Embed only the newest message per conversation, for the one-line row preview.
	//
	// ADM-36: the `.or()` is the scoping. `userId` used to reach only
	// buildSummary, which picks the counterpart to display — it decided what the
	// row SAID, never which rows came back.
	const { data: convs } = await supabase
		.from('conversations')
		.select(`${CONVERSATION_COLUMNS}, messages(body)`)
		.or(participantFilter(userId))
		.order('last_message_at', { ascending: false })
		.order('created_at', { referencedTable: 'messages', ascending: false })
		.limit(1, { referencedTable: 'messages' });
	if (!convs || convs.length === 0) return [];

	// Hide conversations nobody has spoken in.
	//
	// `startConversation` has to create the row eagerly — the route is
	// /messages/<id>, so an id must exist before the thread can be opened. A buyer
	// who clicks "Message seller", reads the page and leaves without typing
	// therefore leaves a real but empty conversation, which showed up in BOTH
	// inboxes: the buyer sees a thread they never wrote in, and worse, the seller
	// gets one from someone who never said anything.
	//
	// Filtering here rather than deferring creation: routing needs the id, so
	// deferring would mean restructuring the thread route for no visible gain.
	// Nothing is deleted, and nothing is stranded — startConversation is
	// idempotent on the (listing_id, buyer_id) unique constraint, so clicking
	// "Message seller" again reopens this same row rather than making another.
	//
	// The embed is already limited to the newest message per conversation, so an
	// empty `messages` array is exactly "no messages" and costs no extra query.
	const spoken = convs.filter((c) => c.messages.length > 0);
	if (spoken.length === 0) return [];

	const [parties, listings] = await Promise.all([
		fetchParties(supabase, spoken),
		fetchListingMeta(spoken.map((c) => c.listing_id))
	]);

	return spoken.map((c) => ({
		...buildSummary(c, userId, parties, listings),
		lastMessagePreview: c.messages[0]?.body ?? null
	}));
}

/** A single conversation with the same joins, or null if the user is not a participant. */
export async function getConversation(
	supabase: DB,
	userId: string,
	conversationId: string
): Promise<ConversationSummary | null> {
	const { data: conv } = await supabase
		.from('conversations')
		.select(CONVERSATION_COLUMNS)
		.eq('id', conversationId)
		.or(participantFilter(userId))
		.maybeSingle();
	// ADM-36: null means "no such conversation, or the caller is not a party to
	// it" — and those two now coincide for EVERY role. They used to coincide only
	// for non-admins: this read was scoped by RLS alone, whose admin arm returned
	// the row, so the 404 the thread route raises was load-bearing by accident
	// and simply did not fire for an admin. The filter above is what makes the
	// comment true rather than merely usually true.
	if (!conv) return null;

	const [parties, listings] = await Promise.all([
		fetchParties(supabase, [conv]),
		fetchListingMeta([conv.listing_id])
	]);
	return buildSummary(conv, userId, parties, listings);
}

/**
 * Messages in a conversation, oldest-first, scoped to a participant.
 *
 * ADM-36. `messages` carries no party columns of its own, so the scope is an
 * INNER JOIN onto the parent conversation with the participant filter applied
 * there: a caller who is neither party matches no parent row and therefore
 * receives no messages. `messages_select` keeps its `OR is_admin()` arm
 * (ADM-37) and is no longer what decides this.
 *
 * FILTERED IN SQL RATHER THAN SEQUENCED BEHIND getConversation. The thread route
 * runs both in one Promise.all, so a dependency on getConversation's result
 * would have to serialise them — and an ordering that happens to be safe is not
 * a check. Making this query self-scoping keeps the parallelism and removes the
 * possibility of a future caller getting the order wrong.
 */
export async function listMessages(
	supabase: DB,
	userId: string,
	conversationId: string
): Promise<ThreadMessage[]> {
	const { data } = await supabase
		.from('messages')
		.select('id, sender_id, body, created_at, conversations!inner(buyer_id, seller_id)')
		.eq('conversation_id', conversationId)
		.or(participantFilter(userId), { referencedTable: 'conversations' })
		.order('created_at', { ascending: true });

	// Drop the join column the filter needed; the thread renders only these four.
	return (data ?? []).map((m) => ({
		id: m.id,
		sender_id: m.sender_id,
		body: m.body,
		created_at: m.created_at
	}));
}

/** Count of the user's UNREAD conversations (D5) — for the header badge. */
export async function unreadConversationCount(supabase: DB, userId: string): Promise<number> {
	// ADM-36: scoped in SQL. The returned COUNT was already correct without this
	// — isConversationUnread resolves lastRead to null when the caller is neither
	// party and returns false — but the QUERY pulled every conversation row on
	// the platform into this function for an admin, on every page load and every
	// incoming message, both parties' ids and read timestamps included. The JS
	// predicate was doing scoping the SQL should have done; it stays as
	// belt-and-braces rather than as the only thing standing there.
	const { data } = await supabase
		.from('conversations')
		.select('buyer_id, seller_id, last_message_at, buyer_last_read_at, seller_last_read_at')
		.or(participantFilter(userId));
	if (!data) return 0;
	return data.reduce((n, c) => (isConversationUnread(c, userId) ? n + 1 : n), 0);
}

// ── Mutations ───────────────────────────────────────────────────────────────

export type StartResult = { ok: true; conversationId: string } | { ok: false; error: string };
export type SendResult = { ok: true } | { ok: false; error: string };

/**
 * Find-or-create the (listing, buyer) conversation and return its id. Idempotent:
 * a buyer returning to the same listing lands in their existing thread. Guards are
 * friendly-message backstops in front of RLS (which enforces the same rules).
 */
export async function startConversation(
	supabase: DB,
	userId: string,
	listingId: string
): Promise<StartResult> {
	const { data: listing } = await supabase
		.from('listings')
		.select('id, seller_id, status')
		.eq('id', listingId)
		.maybeSingle();

	if (!listing) return { ok: false, error: 'This listing is no longer available.' };
	if (listing.seller_id === userId) return { ok: false, error: 'This is your own listing.' };
	if (listing.status !== 'active') {
		return { ok: false, error: "This listing isn't open for new messages." };
	}

	// Existing thread? (unique on (listing_id, buyer_id))
	const existing = await findConversation(supabase, listingId, userId);
	if (existing) return { ok: true, conversationId: existing };

	const { data: created, error } = await supabase
		.from('conversations')
		.insert({ listing_id: listingId, buyer_id: userId, seller_id: listing.seller_id })
		.select('id')
		.single();
	if (created) return { ok: true, conversationId: created.id };

	// Lost a race to create the same thread — the unique constraint fired; re-read it.
	if (error?.code === '23505') {
		const again = await findConversation(supabase, listingId, userId);
		if (again) return { ok: true, conversationId: again };
	}
	return { ok: false, error: 'Could not start the conversation. Please try again.' };
}

/** Validate + insert a message. RLS blocks sends on deleted/removed listings. */
export async function sendMessage(
	supabase: DB,
	userId: string,
	conversationId: string,
	body: unknown
): Promise<SendResult> {
	const parsed = validateMessageBody(body);
	if (!parsed.ok) return { ok: false, error: parsed.error };

	const { error } = await supabase
		.from('messages')
		.insert({ conversation_id: conversationId, sender_id: userId, body: parsed.value });
	if (error) {
		// The user is already a verified participant (the thread load guards that),
		// so an insert denial here means the listing is deleted/removed (D3).
		return {
			ok: false,
			error: 'This conversation is closed — the listing is no longer available.'
		};
	}
	return { ok: true };
}

/**
 * Advance the caller's own last-read timestamp to now. Best-effort: called from
 * the thread load, so a failure must never break rendering the thread.
 */
export async function markRead(
	supabase: DB,
	userId: string,
	conversationId: string
): Promise<void> {
	const { data: conv } = await supabase
		.from('conversations')
		.select('buyer_id, seller_id')
		.eq('id', conversationId)
		.maybeSingle();
	if (!conv) return;

	const now = new Date().toISOString();
	if (conv.buyer_id === userId) {
		await supabase
			.from('conversations')
			.update({ buyer_last_read_at: now })
			.eq('id', conversationId);
	} else if (conv.seller_id === userId) {
		await supabase
			.from('conversations')
			.update({ seller_last_read_at: now })
			.eq('id', conversationId);
	}
}

// ── Internals ───────────────────────────────────────────────────────────────

/** The id of the (listing, buyer) conversation if one exists, else null. Also used
 *  by the listing page to decide "Message seller" vs "View conversation". */
/**
 * Like findConversation, but only counts a thread somebody has actually spoken in.
 *
 * For UI LABELS, not for routing decisions. "View conversation" has to mean the
 * same thing everywhere: a conversation row created by an abandoned "Message
 * seller" click is hidden from the inbox (see listConversations), so offering
 * "View conversation" for it sent the buyer to a thread that appears in no list
 * — three surfaces disagreeing about whether the same conversation exists.
 *
 * findConversation itself deliberately still matches empty rows: startConversation
 * relies on that for idempotency against the (listing_id, buyer_id) unique
 * constraint, and must reuse the existing row rather than fail to find it and try
 * to insert a duplicate.
 *
 * Costs no extra round trip over findConversation — the embed is limited to one
 * message and only its presence is read.
 */
export async function findSpokenConversation(
	supabase: DB,
	listingId: string,
	buyerId: string
): Promise<string | null> {
	const { data: conv } = await supabase
		.from('conversations')
		.select('id')
		.eq('listing_id', listingId)
		.eq('buyer_id', buyerId)
		.maybeSingle();
	if (!conv) return null;

	// Deliberately a second query rather than an embed. Embedding messages into a
	// maybeSingle() select returned no row at all here, which silently made every
	// conversation look unspoken — the button would have stopped ever saying
	// "View conversation". A head+count is unambiguous and cheap: it reads no rows.
	const { count } = await supabase
		.from('messages')
		.select('id', { count: 'exact', head: true })
		.eq('conversation_id', conv.id);

	return count && count > 0 ? conv.id : null;
}

export async function findConversation(
	supabase: DB,
	listingId: string,
	buyerId: string
): Promise<string | null> {
	const { data } = await supabase
		.from('conversations')
		.select('id')
		.eq('listing_id', listingId)
		.eq('buyer_id', buyerId)
		.maybeSingle();
	return data?.id ?? null;
}

/** Buyer + seller display profiles for a set of conversations (profiles are world-readable). */
async function fetchParties(
	supabase: DB,
	convs: Pick<ConversationRow, 'buyer_id' | 'seller_id'>[]
): Promise<Map<string, ConversationParty>> {
	const ids = [...new Set(convs.flatMap((c) => [c.buyer_id, c.seller_id]))];
	const { data } = await supabase
		.from('profiles')
		.select('id, full_name, avatar_url')
		.in('id', ids);
	return new Map((data ?? []).map((p) => [p.id, p]));
}

/**
 * Listing title/price/status/cover for a set of conversations, via the service-role
 * client so paused/removed/deleted listings (hidden by `listings_select`) still
 * render for their participants. Scoped to the passed-in listing ids only.
 */
async function fetchListingMeta(listingIds: string[]): Promise<Map<string, ConversationListing>> {
	const ids = [...new Set(listingIds)];
	if (ids.length === 0) return new Map();

	const admin = createSupabaseAdmin();
	const { data } = await admin
		.from('listings')
		.select('id, title, price, status, type, listing_images(storage_path, position)')
		.in('id', ids);

	const map = new Map<string, ConversationListing>();
	for (const l of data ?? []) {
		const cover = coverPath(l.listing_images);
		map.set(l.id, {
			id: l.id,
			title: l.title,
			price: l.price,
			status: l.status,
			type: l.type,
			coverUrl: cover ? publicUrl(admin, cover) : null
		});
	}
	return map;
}

function buildSummary(
	c: ConversationRow,
	userId: string,
	parties: Map<string, ConversationParty>,
	listings: Map<string, ConversationListing>
): ConversationSummary {
	const otherId = c.buyer_id === userId ? c.seller_id : c.buyer_id;
	const otherParty: ConversationParty = parties.get(otherId) ?? {
		id: otherId,
		full_name: 'Unknown user',
		avatar_url: null
	};
	const listing: ConversationListing = listings.get(c.listing_id) ?? {
		id: c.listing_id,
		title: 'Unavailable listing',
		price: 0,
		status: 'removed',
		type: 'product',
		coverUrl: null
	};
	return {
		id: c.id,
		listing,
		otherParty,
		lastMessageAt: c.last_message_at,
		unread: isConversationUnread(c, userId)
	};
}
