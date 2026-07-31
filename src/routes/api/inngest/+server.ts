import { serve } from 'inngest/sveltekit';
import { inngest } from '$lib/server/inngest';
import {
	autoCompleteOrder,
	expireOrder,
	processPaymentEvent,
	payoutInitiateTransfer,
	payoutWeeklySweep
} from '$lib/server/inngest-functions';

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
		payoutWeeklySweep
	]
});
