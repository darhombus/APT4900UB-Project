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

// ── Query helpers ───────────────────────────────────────────────────────────

/** Conversations for the user, newest activity first, with listing + counterpart + unread + preview. */
export async function listConversations(
	supabase: DB,
	userId: string
): Promise<ConversationListItem[]> {
	// Embed only the newest message per conversation, for the one-line row preview.
	const { data: convs } = await supabase
		.from('conversations')
		.select(`${CONVERSATION_COLUMNS}, messages(body)`)
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
		.maybeSingle();
	if (!conv) return null; // not found, or RLS hid it (not a participant)

	const [parties, listings] = await Promise.all([
		fetchParties(supabase, [conv]),
		fetchListingMeta([conv.listing_id])
	]);
	return buildSummary(conv, userId, parties, listings);
}

/** Messages in a conversation, oldest-first. RLS restricts this to participants. */
export async function listMessages(supabase: DB, conversationId: string): Promise<ThreadMessage[]> {
	const { data } = await supabase
		.from('messages')
		.select('id, sender_id, body, created_at')
		.eq('conversation_id', conversationId)
		.order('created_at', { ascending: true });
	return data ?? [];
}

/** Count of the user's UNREAD conversations (D5) — for the header badge. */
export async function unreadConversationCount(supabase: DB, userId: string): Promise<number> {
	const { data } = await supabase
		.from('conversations')
		.select('buyer_id, seller_id, last_message_at, buyer_last_read_at, seller_last_read_at');
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
