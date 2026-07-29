import { json } from '@sveltejs/kit';
import { createSupabaseAdmin } from '$lib/server/supabase-admin';
import { getPaystackClient } from '$lib/server/paystack';
import { inngest, paymentEventReceived } from '$lib/server/inngest';
import { handlePaystackWebhook } from '$lib/server/webhook';
import type { RequestHandler } from './$types';

/**
 * Paystack's webhook endpoint. Thin by design — the decision logic lives in
 * $lib/server/webhook so it can be tested without a server; this file is wiring.
 *
 * No session: Paystack is a machine caller, authenticated by the HMAC signature
 * over the raw body rather than by a cookie. It is deliberately outside the
 * (protected) group for that reason.
 */
export const POST: RequestHandler = async ({ request }) => {
	// RAW BYTES FIRST. The signature is an HMAC over exactly what was sent, so
	// this must happen before any parsing — re-serialising a parsed body would
	// change key order and whitespace and reject genuine deliveries.
	const rawBody = await request.text();
	const signature = request.headers.get('x-paystack-signature');

	const result = await handlePaystackWebhook(rawBody, signature, {
		paystack: getPaystackClient(),

		// Service-role, and only for this insert. `payments` grants nothing to any
		// client role, and service_role deliberately holds no UPDATE (R-10) — the
		// trail is append-only (D9).
		recordAudit: async (row) => {
			const admin = createSupabaseAdmin();
			const { error } = await admin.from('payments').insert(row);
			if (error) throw new Error(`payments audit insert failed: ${error.message}`);
		},

		sendPaymentEvent: async (input) => {
			await inngest.send(paymentEventReceived.create(input));
		}
	});

	return json({ received: true, outcome: result.outcome }, { status: result.status });
};
