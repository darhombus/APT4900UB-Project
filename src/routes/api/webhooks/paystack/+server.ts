import { json } from '@sveltejs/kit';
import { createSupabaseAdmin } from '$lib/server/supabase-admin';
import { getPaystackClient } from '$lib/server/paystack';
import { boostPaymentEventReceived, inngest, paymentEventReceived } from '$lib/server/inngest';
import { handlePaystackWebhook } from '$lib/server/webhook';
import { emitPayoutSent } from '$lib/server/notification-events';
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
		},

		// Boosts Section 3 (BST-14). A separate event, not a flag on the one above:
		// the two settle different ledgers through different transition functions.
		sendBoostPaymentEvent: async (input) => {
			await inngest.send(boostPaymentEventReceived.create(input));
		},

		// Payouts Section 8. Wiring only — the decision logic lives in $lib/server/webhook
		// alongside the charge logic, and the charge path is unaffected by its presence.
		payouts: {
			// P8's direct verify. Through the client abstraction, so PAYSTACK_MOCK
			// governs it exactly as it governs charge verification.
			verifyTransfer: async (reference) => getPaystackClient().verifyTransfer(reference),

			findPayoutByReference: async (reference) => {
				const admin = createSupabaseAdmin();
				const { data, error } = await admin
					.from('payouts')
					.select('id, status')
					.eq('paystack_transfer_reference', reference)
					.maybeSingle();
				if (error) throw new Error(`payout lookup failed: ${error.message}`);
				return data;
			},

			// The ONLY write path to payouts.status (P3). Its exception IS the
			// out-of-order guard, so it is deliberately allowed to throw.
			transitionPayout: async (payoutId, newStatus) => {
				const admin = createSupabaseAdmin();
				const { error } = await admin.rpc('transition_payout_status', {
					p_payout_id: payoutId,
					p_new_status: newStatus
				});
				if (error) throw new Error(error.message);
			},

			// Notifications Section 3.2. Wiring only, like everything else in this
			// file — the decision to call it (verified, and the graph accepted the
			// move to success) lives in $lib/server/webhook.
			notifyPayoutSent: emitPayoutSent
		}
	});

	return json({ received: true, outcome: result.outcome }, { status: result.status });
};
