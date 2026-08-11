import { serve } from 'inngest/sveltekit';
import { inngest } from '$lib/server/inngest';
import {
	autoCompleteOrder,
	expireBoost,
	expireOrder,
	processBoostPayment,
	processPaymentEvent,
	payoutInitiateTransfer,
	payoutWeeklySweep
} from '$lib/server/inngest-functions';
import {
	notifyBoostActivated,
	notifyBoostExpiring,
	notifyOrderCompleted,
	notifyOrderPaid,
	notifyPayoutSent,
	notifyReviewReceived,
	notifyReviewResponse,
	pruneNotifications
} from '$lib/server/notification-functions';

/**
 * Inngest's serve endpoint — the single URL Inngest talks to.
 *
 * GET  — introspection: Inngest (and the local dev server) reads the registered
 *        function list from here to discover the app.
 * PUT  — registration/sync, triggered from the Inngest dashboard or CLI.
 * POST — invocation: Inngest calls back here to execute a function step.
 *
 * Registered functions live in $lib/server/inngest-functions.
 *
 * The signing key authenticates Inngest's calls to us. In inngest v4 it lives on
 * the client rather than here — see $lib/server/inngest. It is undefined locally
 * (the dev server runs unauthenticated) and required on every Vercel tier.
 *
 * This route is deliberately outside the (protected) group: Inngest is a machine
 * caller with no session, authenticated by the signing key instead.
 */
export const { GET, POST, PUT } = serve({
	client: inngest,
	functions: [
		processPaymentEvent,
		expireOrder,
		autoCompleteOrder,
		payoutInitiateTransfer,
		payoutWeeklySweep,
		processBoostPayment,
		expireBoost,
		// Notifications (Phase 7). Leaves, every one: nothing downstream waits on a
		// notification, which is why a failure here degrades rather than cascades.
		notifyOrderPaid,
		notifyOrderCompleted,
		notifyPayoutSent,
		notifyReviewReceived,
		notifyReviewResponse,
		notifyBoostActivated,
		notifyBoostExpiring,
		pruneNotifications
	]
});
