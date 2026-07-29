import { createSupabaseAdmin } from '$lib/server/supabase-admin';
import { getPaystackClient } from '$lib/server/paystack';
import { processPaymentReference } from '$lib/server/payment-processing';
import { inngest, paymentEventReceived } from '$lib/server/inngest';

/**
 * Inngest functions (Checkout PRD — Sections 6 and 7).
 *
 * Kept out of $lib/server/inngest so that module stays importable by anything
 * that only needs to SEND an event, without dragging the processing code (and
 * the service-role client) along with it.
 */

/**
 * Finalise a payment off the request path.
 *
 * The webhook handler does nothing but authenticate and dispatch, so all of D4's
 * second verification, the amount check and the atomic finalisation happen here,
 * where a retry costs nothing and Paystack is not waiting on us.
 *
 * Retry policy, per Section 6's requirement: business-terminal outcomes RETURN
 * (a failed charge, an unknown reference, a wrong amount are final answers —
 * retrying just burns attempts), while infrastructure failures THROW and are
 * retried. `processPaymentReference` enforces that split; this function only has
 * to not swallow the throws.
 *
 * Idempotency (D10): safe to run any number of times for a reference. The second
 * run finds the order already `paid`, records `noop_already_paid`, and returns
 * normally. `finalize_order_payment` guarantees the database side independently.
 */
export const processPaymentEvent = inngest.createFunction(
	// v4 takes the trigger inside the options object, not as a second argument.
	{ id: 'process-payment-event', retries: 3, triggers: [paymentEventReceived] },
	async ({ event, step }) => {
		const { reference, eventType } = event.data;

		// One step rather than the three the prompt sketches (verify / validate /
		// finalize). Section 8's callback page must run the SAME path, and D10 only
		// makes the webhook/callback race safe if both sides agree on what a verify
		// response means — splitting this across Inngest steps would force the
		// callback to reimplement the sequence. Re-verifying on retry is cheap and,
		// if anything, safer than replaying a memoised verify.
		const result = await step.run('verify-validate-finalize', async () =>
			processPaymentReference(reference, {
				paystack: getPaystackClient(),
				admin: createSupabaseAdmin()
			})
		);

		return { ...result, reference, eventType };
	}
);
