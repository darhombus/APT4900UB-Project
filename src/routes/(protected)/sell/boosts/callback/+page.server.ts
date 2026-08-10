import { error } from '@sveltejs/kit';
import { createSupabaseAdmin } from '$lib/server/supabase-admin';
import { getPaystackClient } from '$lib/server/paystack';
import { processBoostReference } from '$lib/server/boosts';
import type { PageServerLoad } from './$types';

/**
 * Where Paystack sends the seller after paying for a boost (Boosts PRD — Section 3).
 *
 * The SECOND of two settlement paths; the webhook is the first and usually wins.
 * The reference is the idempotency key that makes running both safe: whichever
 * arrives second finds the boost already terminal and does nothing. This page
 * therefore never waits on the webhook — it verifies and settles directly, so a
 * seller whose webhook is delayed still gets a confirmed boost rather than a
 * spinner.
 */

export type BoostCallbackState = 'success' | 'pending' | 'failed';

export const load: PageServerLoad = async ({ url, locals: { supabase } }) => {
	// Paystack sends `reference`; some flows send `trxref`. Accept both.
	const reference = url.searchParams.get('reference') ?? url.searchParams.get('trxref');
	if (!reference) error(400, 'Missing payment reference');

	// The caller's OWN client first: boosts_select scopes this to seller_id =
	// auth.uid(), so a stranger's reference simply returns nothing and 404s. This
	// runs BEFORE any service-role work — the admin client bypasses RLS, so the
	// ownership question has to be answered while RLS is still in play.
	const { data: owned } = await supabase
		.from('boosts')
		.select('id, listing_id, duration_days, price_kes_charged')
		.eq('paystack_reference', reference)
		.maybeSingle();

	if (!owned) error(404, 'Boost not found');

	const result = await processBoostReference(reference, {
		paystack: getPaystackClient(),
		admin: createSupabaseAdmin()
	});

	// `noop_already_settled` means the webhook got there first. That is a success
	// from the seller's point of view IF the boost is active — so re-read rather
	// than inferring from the outcome alone.
	const { data: settled } = await supabase
		.from('boosts')
		.select('status, expires_at')
		.eq('paystack_reference', reference)
		.maybeSingle();

	const { data: listing } = await supabase
		.from('listings')
		.select('id, title')
		.eq('id', owned.listing_id)
		.maybeSingle();

	let state: BoostCallbackState;
	if (settled?.status === 'active') state = 'success';
	else if (settled?.status === 'failed') state = 'failed';
	// Still pending: either the charge is genuinely in flight, or verify was
	// unreachable. Neither is a decline, and neither may be rendered as one.
	else state = 'pending';

	return {
		state,
		listingId: owned.listing_id,
		listingTitle: listing?.title ?? 'your listing',
		durationDays: owned.duration_days,
		expiresAt: settled?.expires_at ?? null,
		reason: result.reason ?? null
	};
};
