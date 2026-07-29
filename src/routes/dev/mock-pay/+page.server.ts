import { error, fail, redirect } from '@sveltejs/kit';
import { createSupabaseAdmin } from '$lib/server/supabase-admin';
import {
	getMockPaystackClient,
	isPaystackMockEnabled,
	PAYSTACK_CURRENCY
} from '$lib/server/paystack';
import type { Actions, PageServerLoad } from './$types';

/**
 * Dev-only stand-in for Paystack's hosted checkout page (Section 4).
 *
 * The mock client's authorization_url points here, so the local flow is:
 *   Buy now → /dev/mock-pay?reference=… → simulate → webhook + callback
 *
 * The two buttons do exactly what Paystack would: seed the verify response for
 * the reference, then POST a genuinely-signed webhook to our own endpoint. The
 * signature is real (see MockPaystackClient.signAsPaystack), so this exercises
 * the true verification path rather than tiptoeing around it.
 *
 * 404s unless PAYSTACK_MOCK=1 — and PAYSTACK_MOCK=1 alongside VERCEL throws in
 * getPaystackClient, so this can never be reachable on a deployed tier.
 */

/** Reachable only in mock mode; every entry point checks this first. */
function requireMockMode() {
	if (!isPaystackMockEnabled()) error(404, 'Not found');
}

export const load: PageServerLoad = async ({ url }) => {
	requireMockMode();

	const reference = url.searchParams.get('reference') ?? '';
	if (!reference) error(400, 'Missing reference');

	// Service-role: this page runs outside any session and only ever exists locally.
	const admin = createSupabaseAdmin();
	const { data: order } = await admin
		.from('orders')
		.select('id, amount_total, status, listings(title)')
		.eq('paystack_reference', reference)
		.maybeSingle();

	if (!order) error(404, 'No order for that reference');

	return {
		reference,
		amountCents: order.amount_total,
		status: order.status,
		listingTitle: order.listings?.title ?? 'Listing'
	};
};

/** Post a signed webhook to our own endpoint, exactly as Paystack would. */
async function deliverWebhook(
	fetchImpl: typeof fetch,
	origin: string,
	event: string,
	reference: string,
	amountCents: number
): Promise<void> {
	const mock = getMockPaystackClient();
	const rawBody = JSON.stringify({
		event,
		data: {
			reference,
			status: event === 'charge.success' ? 'success' : 'failed',
			amount: amountCents,
			currency: PAYSTACK_CURRENCY
		}
	});

	try {
		const response = await fetchImpl(new URL('/api/webhooks/paystack', origin), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-paystack-signature': mock.signAsPaystack(rawBody)
			},
			body: rawBody
		});
		if (!response.ok) {
			// Expected until Section 5 builds the endpoint. The callback page
			// (Section 8) verifies directly, so the flow still converges.
			console.warn('[mock-pay] webhook POST returned %d for %s', response.status, reference);
		}
	} catch (err) {
		console.warn('[mock-pay] webhook POST failed for %s', reference, err);
	}
}

export const actions: Actions = {
	success: async ({ url, fetch, request }) => {
		requireMockMode();

		const form = await request.formData();
		const reference = String(form.get('reference') ?? '');
		const amountCents = Number(form.get('amountCents') ?? 0);
		if (!reference || !amountCents) return fail(400, { formError: 'Missing reference or amount.' });

		// Seed the verify response first: the webhook handler re-verifies (D4), so
		// the registry has to answer 'success' before the webhook arrives.
		getMockPaystackClient().seedVerify(reference, { status: 'success', amountCents });
		await deliverWebhook(fetch, url.origin, 'charge.success', reference, amountCents);

		redirect(303, `/checkout/callback?reference=${encodeURIComponent(reference)}`);
	},

	failure: async ({ url, fetch, request }) => {
		requireMockMode();

		const form = await request.formData();
		const reference = String(form.get('reference') ?? '');
		const amountCents = Number(form.get('amountCents') ?? 0);
		if (!reference) return fail(400, { formError: 'Missing reference.' });

		getMockPaystackClient().seedVerify(reference, { status: 'failed', amountCents });
		await deliverWebhook(fetch, url.origin, 'charge.failed', reference, amountCents);

		redirect(303, `/checkout/callback?reference=${encodeURIComponent(reference)}`);
	}
};
