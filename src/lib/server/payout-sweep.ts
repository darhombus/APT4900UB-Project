import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { MIN_PAYOUT_KES_CENTS } from '$lib/server/payout-constants';
import { isInFlightViolation } from '$lib/server/payout-request';

/**
 * The weekly sweep's body (Payouts PRD — Section 9; P5, P6, P10).
 *
 * Extracted from the Inngest function so the loop — which is where the
 * skip-on-conflict and double-run behaviour lives — is testable without a
 * scheduler. The Inngest function is then just the schedule plus two steps.
 *
 * Eligibility itself is NOT here: it is one SQL query
 * (`payout_sweep_candidates`), because all three conditions are relational and
 * a TypeScript filter over three round trips would be both slower and easier to
 * get subtly wrong.
 */

export interface SweepCandidate {
	seller_id: string;
	recipient_code: string;
	amount_kes_cents: number;
}

export interface SweepResult {
	/** Sellers the query returned as eligible. */
	eligible: number;
	/** Payout rows actually written this run. */
	created: number;
	/** Sellers skipped because the in-flight index refused the insert (P10). */
	skippedInFlight: number;
	/** Payout ids created by THIS run. */
	payoutIds: string[];
	/** Every seller the query considered eligible, created or skipped. */
	sellerIds: string[];
}

/**
 * Create one weekly payout per eligible seller.
 *
 * SAFE TO RUN TWICE. Two independent reasons, and both matter because an Inngest
 * retry re-runs this whole function:
 *   1. `payout_sweep_candidates` excludes sellers who already have an in-flight
 *      payout, so a second run simply finds fewer candidates.
 *   2. If a candidate slips through anyway — a concurrent instant withdrawal
 *      between the query and the insert — the partial unique index refuses the
 *      row and we skip it. THAT is the authoritative guard; the query is an
 *      optimisation that avoids doomed inserts.
 */
export async function runWeeklySweep(
	admin: SupabaseClient<Database>,
	options: { minKesCents?: number } = {}
): Promise<SweepResult> {
	const minKesCents = options.minKesCents ?? MIN_PAYOUT_KES_CENTS;

	const { data: candidates, error } = await admin.rpc('payout_sweep_candidates', {
		p_min_kes_cents: minKesCents
	});

	// Database trouble is infrastructure — throw so Inngest retries.
	if (error) throw new Error(`payout_sweep_candidates failed: ${error.message}`);

	const rows = (candidates ?? []) as SweepCandidate[];
	const result: SweepResult = {
		eligible: rows.length,
		created: 0,
		skippedInFlight: 0,
		payoutIds: [],
		sellerIds: rows.map((row) => row.seller_id)
	};

	for (const candidate of rows) {
		// The id is generated here rather than by the column default, because
		// paystack_transfer_reference must equal it (P7) and a column default
		// cannot reference another column of the same row.
		const payoutId = crypto.randomUUID();

		const { error: insertError } = await admin.from('payouts').insert({
			id: payoutId,
			seller_id: candidate.seller_id,
			amount_kes_cents: candidate.amount_kes_cents,
			// P5 — the weekly sweep is FREE. The 1% is what an instant withdrawal
			// buys you out of waiting for.
			fee_kes_cents: 0,
			recipient_code: candidate.recipient_code,
			paystack_transfer_reference: payoutId,
			origin: 'weekly'
		});

		if (insertError) {
			if (isInFlightViolation(insertError)) {
				// Someone withdrew between the query and this insert. Their money is
				// already on its way; next Monday picks up whatever is left.
				result.skippedInFlight += 1;
				continue;
			}
			// Anything else is not a race we understand — let it retry.
			throw new Error(`weekly payout insert failed: ${insertError.message}`);
		}

		result.created += 1;
		result.payoutIds.push(payoutId);
	}

	return result;
}

/**
 * Every weekly payout still sitting at 'pending' for the swept sellers.
 *
 * Used instead of "the ids this run created" so that a retry which skipped
 * already-created rows still emits their events. Without this, a sweep that
 * crashed after inserting but before emitting would leave those payouts pending
 * forever — the rows would exist, and nothing would ever initiate the transfer.
 *
 * Re-emitting is harmless: `payout-initiate-transfer` exits cleanly for any
 * payout that is no longer 'pending'.
 */
export async function pendingWeeklyPayoutIds(
	admin: SupabaseClient<Database>,
	sellerIds: string[]
): Promise<string[]> {
	if (sellerIds.length === 0) return [];

	const { data, error } = await admin
		.from('payouts')
		.select('id')
		.in('seller_id', sellerIds)
		.eq('origin', 'weekly')
		.eq('status', 'pending');

	if (error) throw new Error(`pending weekly payout lookup failed: ${error.message}`);
	return (data ?? []).map((row) => row.id);
}
