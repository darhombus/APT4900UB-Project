/**
 * Payout display helpers, shared by the payouts page and its specs.
 *
 * Presentation only — nothing here decides anything. The status vocabulary is
 * the database's (P3's five-value check constraint); this maps it to the words
 * and tones a seller sees.
 */

type PayoutBadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'error';

/**
 * Plain language over jargon. A seller does not need to know that 'processing'
 * means a Paystack transfer is in flight — only that the money is on its way and
 * they need do nothing.
 */
export function payoutStatusLabel(status: string): string {
	switch (status) {
		case 'pending':
			return 'Queued';
		case 'processing':
			return 'Sending';
		case 'success':
			return 'Sent';
		case 'failed':
			return 'Failed';
		case 'reversed':
			return 'Reversed';
		default:
			return status;
	}
}

export function payoutStatusVariant(status: string): PayoutBadgeVariant {
	switch (status) {
		case 'success':
			return 'success';
		case 'processing':
			return 'brand';
		case 'pending':
			return 'neutral';
		case 'failed':
		case 'reversed':
			return 'error';
		default:
			return 'neutral';
	}
}

/** Instant / Weekly, for the history table's origin column. */
export function payoutOriginLabel(origin: string): string {
	return origin === 'weekly' ? 'Weekly' : 'Instant';
}
