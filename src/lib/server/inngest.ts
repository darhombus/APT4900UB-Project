import { Inngest, eventType, staticSchema, type InngestFunction } from 'inngest';
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

/**
 * Every Inngest function in the app, registered by the serve route. Sections 6
 * and 7 add to this: process-payment-event, then expire-order. An empty list is
 * a valid registration — the dev server still discovers the app.
 */
export const inngestFunctions: InngestFunction.Any[] = [];
