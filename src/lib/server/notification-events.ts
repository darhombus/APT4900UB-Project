import {
	inngest,
	orderCompleted,
	payoutSent,
	reviewReceived,
	reviewResponse
} from '$lib/server/inngest';

/**
 * ⚠️ SERVER-ONLY. The emission points this phase adds (Notifications PRD —
 * Section 3.2).
 *
 * Minimal by instruction: an event name and entity ids, nothing else. The
 * handler reads the source row itself rather than trusting a payload, which is
 * the same rule every other event in this app follows.
 *
 * WHY THESE SWALLOW THEIR ERRORS, when the Paystack webhook's emission
 * deliberately does not. That one lets a dispatch failure surface as a non-2xx
 * so Paystack retries, because losing it would strand a payment. These are
 * different: by the time they run, the thing the user asked for HAS happened —
 * the order is completed, the review is written, the reply is posted — and the
 * user is one redirect away from seeing it. Failing their action to report that
 * a notification could not be queued would turn a missing email into a broken
 * page. So the failure is logged loudly and the action proceeds.
 *
 * The tradeoff is explicit: a dropped event means a notification nobody gets and
 * nothing retries. That is acceptable for a leaf, and the log line is what makes
 * it diagnosable.
 */

async function emit(what: string, send: () => Promise<unknown>): Promise<void> {
	try {
		await send();
	} catch (err) {
		console.error(
			'[notifications] could not emit %s: %s',
			what,
			err instanceof Error ? err.message : String(err)
		);
	}
}

/** An order reached `completed`. Emitted from BOTH completion paths (NTF-17). */
export async function emitOrderCompleted(orderId: string): Promise<void> {
	await emit(`order.completed(${orderId})`, () => inngest.send(orderCompleted.create({ orderId })));
}

/** A buyer left a review. Carries the order id — see the event's own comment. */
export async function emitReviewReceived(orderId: string): Promise<void> {
	await emit(`review.received(${orderId})`, () => inngest.send(reviewReceived.create({ orderId })));
}

/** A seller replied to a review. */
export async function emitReviewResponse(reviewId: string): Promise<void> {
	await emit(`review.response(${reviewId})`, () =>
		inngest.send(reviewResponse.create({ reviewId }))
	);
}

/**
 * A transfer was verified as sent.
 *
 * Injected into `handlePaystackWebhook` as a callback rather than imported by
 * it (the ratified survey): that module is pure decision logic with every
 * side effect passed in, and importing the Inngest client there would make it
 * untestable without one.
 */
export async function emitPayoutSent(payoutId: string): Promise<void> {
	await emit(`payout.sent(${payoutId})`, () => inngest.send(payoutSent.create({ payoutId })));
}
