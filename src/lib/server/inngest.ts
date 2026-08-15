import { Inngest, eventType, staticSchema } from 'inngest';
import { dev } from '$app/environment';
import { env } from '$lib/server/env';

/**
 * ⚠️ SERVER-ONLY. The Inngest client and the phase's event contract.
 *
 * Inngest carries the checkout work that must not run inside a request:
 *   - payment processing, so the webhook handler can return 200 immediately and
 *     do no order mutation itself (Section 6)
 *   - the 30-minute pending-order hold expiry (Section 7)
 *
 * LOCAL WORKFLOW
 * Run the dev server alongside the app:
 *     npm run dev                  # the app on http://localhost:5173
 *     npx inngest-cli@latest dev   # dashboard on http://localhost:8288
 * The dev server discovers this app by polling /api/inngest and runs
 * unauthenticated, so INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY are not needed
 * locally. Both ARE required on every Vercel tier (Section 11 sets them).
 * Sleeps, retries and step state behave as in production, so `step.sleep` is
 * observable locally without waiting it out — ORDER_HOLD_MINUTES shortens the
 * hold for tests.
 *
 * NOTE ON THE API: this is inngest v4, where events are declared with
 * `eventType()` + `staticSchema()`. v3's `new EventSchemas().fromRecord<…>()`
 * (which the PRD's Section 3 text describes) no longer exists, and `signingKey`
 * moved from the serve handler onto the client.
 */

/**
 * The event contract, defined once. Both events are fire-and-forget from the
 * request's point of view; nothing awaits a function's result.
 *
 * `staticSchema` gives compile-time types with a passthrough validator — no
 * runtime validation and no extra dependency. That is the right trade here:
 * both events are emitted only by our own server code, and the payloads carry
 * identifiers rather than trusted data.
 */

/**
 * A signature-valid Paystack webhook arrived. Carries identifiers only — the
 * function re-verifies against Paystack rather than trusting the payload (D4),
 * so nothing security-relevant travels in the event.
 */
export const paymentEventReceived = eventType('checkout/payment.event.received', {
	schema: staticSchema<{ reference: string; eventType: string }>()
});

/** A pending order was created; starts the hold-expiry countdown (D3). */
export const orderCreated = eventType('checkout/order.created', {
	schema: staticSchema<{ orderId: string }>()
});

/**
 * An order was finalised as paid; starts the 7-day auto-completion countdown
 * (Payouts PRD — Section 4A, ruling PR-7).
 *
 * Emitted from `processPaymentReference` on the `finalized` outcome, which is
 * the one chokepoint BOTH the webhook/Inngest path and the checkout callback
 * page pass through. Emitting from `process-payment-event` instead would
 * silently miss every callback-finalised order.
 *
 * MAY fire more than once for one order: the webhook and the callback can both
 * process the same reference. Consumers must be idempotent.
 */
export const orderPaid = eventType('checkout/order.paid', {
	schema: staticSchema<{ orderId: string }>()
});

/**
 * A seller asked for a payout, or the weekly sweep created one (Payouts PRD —
 * Sections 6, 7 and 9). Carries the payout id only; the transfer function reads
 * the row itself rather than trusting anything in the event.
 *
 * Safe to receive more than once: `payout-initiate-transfer` exits cleanly when
 * the row is no longer 'pending'.
 */
export const payoutRequested = eventType('payout/requested', {
	schema: staticSchema<{ payoutId: string }>()
});

/**
 * A signature-valid Paystack webhook arrived carrying a `boost_` reference
 * (Boosts PRD — Section 3; BST-14).
 *
 * A SEPARATE event from `checkout/payment.event.received`, not a flag on it.
 * The two settle different ledgers through different transition functions, and
 * routing them down one function would put the boost/order branch inside the
 * processor — precisely the seam BST-11 wants kept visible. Identifiers only,
 * for the same reason as the checkout event: the function re-verifies.
 */
export const boostPaymentEventReceived = eventType('boost/payment.event.received', {
	schema: staticSchema<{ reference: string; eventType: string }>()
});

/**
 * A boost was activated; starts the expiry countdown (Section 4; BST-9).
 *
 * Carries `expiresAt` so the function can `sleepUntil` a fixed instant rather
 * than a duration. The value is immutable for the life of the row — an
 * extension creates a NEW boost and supersedes this one (BST-5) rather than
 * moving this window — so the sleep target can never go stale.
 *
 * MAY fire more than once for one boost: the webhook and the callback can both
 * settle the same reference. The consumer keys idempotency on boostId.
 */
export const boostActivated = eventType('boost/activated', {
	schema: staticSchema<{ boostId: string; expiresAt: string }>()
});

/**
 * An order reached `completed` (Notifications PRD — Section 3; NTF-17).
 *
 * EMITTED FROM TWO PLACES, deliberately and per the ratified survey: the buyer's
 * `confirmReceipt` action and the `auto-complete-order` backstop. There is no
 * single chokepoint the way `finalized` is for payment — `complete_order` and
 * `auto_complete_order` are separate SECURITY DEFINER functions with separate
 * callers — so a single emission point would silently miss half of all
 * completions. Which half depends on how responsive buyers are, which is exactly
 * the kind of bug that hides.
 *
 * Both emissions are safe together: the notification's dedupe_key is the order
 * id, so the unique constraint collapses a double emission to one row per
 * recipient (NTF-17).
 */
export const orderCompleted = eventType('checkout/order.completed', {
	schema: staticSchema<{ orderId: string }>()
});

/**
 * A payout transfer was verified as sent (Notifications PRD — Section 3).
 *
 * Emitted from the transfer-webhook branch, and ONLY after Paystack's direct
 * verify agreed with the webhook and the transition graph accepted the move to
 * `success` (P8). A seller is told their money moved only when the platform
 * itself believes it.
 */
export const payoutSent = eventType('payout/sent', {
	schema: staticSchema<{ payoutId: string }>()
});

/**
 * A buyer left a review (Notifications PRD — Section 3).
 *
 * Carries the ORDER id, not the review id: `insertReview` does not read back the
 * inserted row, and NTF-17 fixes the dedupe_key at the order id anyway — one
 * review per order (the `reviews_order_id_key` unique constraint) makes the two
 * interchangeable as identity, and the order id is the one already in hand.
 */
export const reviewReceived = eventType('review/received', {
	schema: staticSchema<{ orderId: string }>()
});

/** A seller replied to a review (Notifications PRD — Section 3). */
export const reviewResponse = eventType('review/response', {
	schema: staticSchema<{ reviewId: string }>()
});

/**
 * An admin took a listing down (ADM-13).
 *
 * Identifiers only, like every other event here: the Section 6 handler reads
 * the admin_actions row for the moderation note and the listing for its seller
 * rather than trusting a payload. `adminActionId` is also the notification's
 * dedupe key (ADM-13b) — the listing id would collapse a second takedown of the
 * same listing into the first one's notification.
 *
 * Emitted from the /admin/listings takedown action, never from SQL: the database
 * has no outbound HTTP, so admin_set_listing_visibility returns what the action
 * needs and the action sends this.
 */
export const listingRemoved = eventType('listings/listing.removed', {
	schema: staticSchema<{ listingId: string; adminActionId: string }>()
});

export const inngest = new Inngest({
	id: 'mysoko',
	/**
	 * v4 defaults to CLOUD mode and refuses to serve without a signing key, so
	 * this must be explicit. SvelteKit's `dev` is exactly the right signal: true
	 * under `vite dev` (talk to the local dev server, no keys needed), false in
	 * every production build — including the Vercel dev and staging tiers, which
	 * are production builds and do need real keys (Section 11 sets them).
	 */
	isDev: dev,
	// Undefined locally; Inngest then falls back to its own env lookup.
	eventKey: env.INNGEST_EVENT_KEY || undefined,
	signingKey: env.INNGEST_SIGNING_KEY || undefined
});

// Functions live in $lib/server/inngest-functions and are registered by the
// serve route. They are deliberately NOT imported here: this module is what
// request-path code imports to SEND events, and it must not drag the processing
// code — or the service-role client — along with it.
