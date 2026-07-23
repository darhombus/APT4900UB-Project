import type { Database } from '$lib/types/database';

/**
 * Pure, client-safe messaging types and the unread computation. No `$env`, no
 * Supabase client — so it imports cleanly into both the browser and the server
 * layer, and the unread logic stays unit-testable (see messaging.test.ts).
 */

export type ListingStatus = Database['public']['Enums']['listing_status'];
export type ListingType = Database['public']['Enums']['listing_type'];

export type ConversationParty = {
	id: string;
	full_name: string;
	avatar_url: string | null;
};

/** The listing context shown on a conversation row / thread header. */
export type ConversationListing = {
	id: string;
	title: string;
	price: number;
	status: ListingStatus;
	type: ListingType;
	/** Cover-image URL, or null → the caller renders the photo-less placeholder. */
	coverUrl: string | null;
};

export type ConversationSummary = {
	id: string;
	listing: ConversationListing;
	/** The participant who is NOT the viewer (buyer sees the seller and vice versa). */
	otherParty: ConversationParty;
	lastMessageAt: string;
	unread: boolean;
};

/** A conversation-list row: a summary plus the newest message's body for the preview. */
export type ConversationListItem = ConversationSummary & {
	lastMessagePreview: string | null;
};

export type ThreadMessage = Pick<
	Database['public']['Tables']['messages']['Row'],
	'id' | 'sender_id' | 'body' | 'created_at'
>;

/** The activity + last-read fields needed to decide unread — a subset of a conversation row. */
export interface UnreadFields {
	buyer_id: string;
	seller_id: string;
	last_message_at: string;
	buyer_last_read_at: string;
	seller_last_read_at: string;
}

/**
 * D5: a conversation is unread for a participant when its last activity
 * (`last_message_at`) is newer than that participant's last-read timestamp.
 *
 * D5's "...and the last message is not their own" clause is maintained
 * structurally by the message-insert trigger (`messages_touch_conversation`),
 * which advances the sender's own last-read to the message time. So a plain
 * timestamp comparison is exact: a participant who sent the last message has
 * `last_read == last_message_at` and is therefore not unread. A non-participant
 * is never unread.
 */
export function isConversationUnread(conv: UnreadFields, userId: string): boolean {
	const lastRead =
		conv.buyer_id === userId
			? conv.buyer_last_read_at
			: conv.seller_id === userId
				? conv.seller_last_read_at
				: null;
	if (lastRead === null) return false;
	return new Date(conv.last_message_at).getTime() > new Date(lastRead).getTime();
}
