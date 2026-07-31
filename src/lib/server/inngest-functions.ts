import { createSupabaseAdmin } from '$lib/server/supabase-admin';
import { getPaystackClient, PaystackApiError } from '$lib/server/paystack';
import { processPaymentReference } from '$lib/server/payment-processing';
import { orderHoldDuration } from '$lib/server/runtime-env';
import { autoCompleteDuration, WEEKLY_SWEEP_CRON } from '$lib/server/payout-constants';
import { pendingWeeklyPayoutIds, runWeeklySweep } from '$lib/server/payout-sweep';
import {
	inngest,
	orderCreated,
	orderPaid,
	paymentEventReceived,
	payoutRequested
} from '$lib/server/inngest';

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

/**
 * Release a hold that was never paid for (D3).
 *
 * Sleeps out the hold window, then asks the database to expire the order. The
 * race with a payment arriving late in the window is resolved *in the database*,
 * not here: `expire_pending_order` only touches rows still in `pending_payment`,
 * so a paid order is untouched and the call returns false. Payment always wins,
 * and losing the race is a success — there was simply nothing to expire.
 *
 * No audit row: this is not a payment event, and `payments` is the Paystack
 * trail (D9). The order's own `expired_at` is the record.
 *
 * Note on `step.sleep`: Inngest does not hold a process open for the duration —
 * the run is suspended and resumed, so a 30-minute hold costs nothing while it
 * waits and survives a deploy in the middle of it.
 */
export const expireOrder = inngest.createFunction(
	{ id: 'expire-order', retries: 3, triggers: [orderCreated] },
	async ({ event, step }) => {
		const { orderId } = event.data;

		// Read inside the handler so the value is resolved at execution time, which
		// is what lets a test set ORDER_HOLD_MINUTES low without a rebuild.
		await step.sleep('hold-window', orderHoldDuration());

		const expired = await step.run('expire', async () => {
			const admin = createSupabaseAdmin();
			// Service-role only: expire_pending_order revokes EXECUTE from anon and
			// authenticated (R-10).
			const { data, error } = await admin.rpc('expire_pending_order', { p_order_id: orderId });
			// Database trouble is infrastructure — throw so Inngest retries. A
			// no-op (data === false) is a normal outcome and returns cleanly.
			if (error) throw new Error(`expire_pending_order failed: ${error.message}`);
			return data === true;
		});

		return { orderId, expired };
	}
);

/**
 * Complete a paid order the buyer never confirmed (Payouts PRD — Section 4A).
 *
 * Why this exists: `completed`/`completed_at` is the sole payout-eligibility
 * trigger (PR-4), and the only other route to it is the buyer pressing "confirm
 * receipt". Without this backstop a buyer who simply stops responding strands
 * the seller's money permanently — the 2-day payout hold never even starts.
 *
 * Two independent guards, deliberately:
 *   - `idempotency` below collapses duplicate `checkout/order.paid` deliveries
 *     (the webhook and the callback can both finalise the same reference) into
 *     one run per order.
 *   - `auto_complete_order`'s own SQL predicate re-checks status='paid' AND
 *     paid_at older than 7 days. THAT is the guarantee. The Inngest-side
 *     deduplication is an optimisation, never the sole reliance — a replayed
 *     event outside the idempotency window still cannot complete an order early.
 *
 * Losing the race to the buyer is a SUCCESS (false = nothing to do), exactly as
 * it is for expire-order: the order reached `completed` either way, which is all
 * the payouts phase needs.
 */
export const autoCompleteOrder = inngest.createFunction(
	{
		id: 'auto-complete-order',
		retries: 3,
		// One run per order, whichever path emitted the event first.
		idempotency: 'event.data.orderId',
		triggers: [orderPaid]
	},
	async ({ event, step }) => {
		const { orderId } = event.data;

		// Read inside the handler so the value resolves at execution time, which is
		// what lets a test set AUTO_COMPLETE_DAYS_OVERRIDE low without a rebuild.
		// Inngest suspends the run rather than holding a process open, so a 7-day
		// sleep costs nothing while it waits and survives deploys in the middle.
		await step.sleep('auto-complete-window', autoCompleteDuration());

		const completed = await step.run('auto-complete', async () => {
			const admin = createSupabaseAdmin();
			// Service-role only: auto_complete_order revokes EXECUTE from public,
			// anon and authenticated (PR-10). complete_order — the buyer's path — is
			// untouched and still the only route granted to `authenticated`.
			const { data, error } = await admin.rpc('auto_complete_order', { p_order_id: orderId });
			// Database trouble is infrastructure — throw so Inngest retries. A no-op
			// (data === false) is a normal outcome and returns cleanly.
			if (error) throw new Error(`auto_complete_order failed: ${error.message}`);
			return data === true;
		});

		return { orderId, completed };
	}
);

/**
 * Send a requested payout to Paystack (Payouts PRD — Section 7; P7, P8).
 *
 * TWO steps rather than one, deliberately. Inngest memoises a completed step, so
 * splitting "claim the row" from "call Paystack" means a retry of the Paystack
 * call does NOT re-run the claim. Were it one step, a network blip would leave
 * the row at 'processing' and the retry would read a non-pending row and exit as
 * a no-op — the transfer would never be sent.
 *
 * Success is NEVER set here (task f). Initiation only tells us Paystack accepted
 * the instruction; whether the money arrived comes from the webhook plus a
 * direct verify in Section 8.
 */
export const payoutInitiateTransfer = inngest.createFunction(
	{ id: 'payout-initiate-transfer', retries: 3, triggers: [payoutRequested] },
	async ({ event, step }) => {
		const { payoutId } = event.data;

		// STEP 1 — claim the payout by moving it pending → processing.
		const claim = await step.run('claim-payout', async () => {
			const admin = createSupabaseAdmin();

			const { data: payout, error } = await admin
				.from('payouts')
				.select(
					'id, status, transfer_amount_kes_cents, amount_kes_cents, fee_kes_cents, recipient_code, paystack_transfer_reference'
				)
				.eq('id', payoutId)
				.maybeSingle();

			// Database trouble is infrastructure — throw so Inngest retries.
			if (error) throw new Error(`payout lookup failed: ${error.message}`);

			if (!payout) {
				// An event for a row we do not have. Nothing to retry towards.
				console.error('[payouts] payout/requested for unknown payout %s', payoutId);
				return { proceed: false as const, outcome: 'unknown_payout' };
			}

			// (a) Idempotent re-entry: a duplicate event, or a second run after the
			// row already moved on, is a clean no-op rather than a second transfer.
			if (payout.status !== 'pending') {
				return { proceed: false as const, outcome: 'noop_not_pending', status: payout.status };
			}

			// (b) The transition function is the ONLY write path to status (P3).
			const { error: transitionError } = await admin.rpc('transition_payout_status', {
				p_payout_id: payoutId,
				p_new_status: 'processing'
			});

			if (transitionError) {
				// A concurrent run claimed it between our read and this call. The
				// transition graph rejected the second attempt, which is the guard
				// working — treat it as the no-op it is, not as an error.
				console.warn(
					'[payouts] could not claim payout %s (already claimed?): %s',
					payoutId,
					transitionError.message
				);
				return { proceed: false as const, outcome: 'noop_claim_lost' };
			}

			return {
				proceed: true as const,
				// Generated column; it is `amount - fee` and both are NOT NULL.
				amountKesCents:
					payout.transfer_amount_kes_cents ?? payout.amount_kes_cents - payout.fee_kes_cents,
				recipientCode: payout.recipient_code,
				reference: payout.paystack_transfer_reference
			};
		});

		if (!claim.proceed) return { payoutId, ...claim };

		// STEP 2 — instruct Paystack. Separate step so a retry lands HERE.
		const result = await step.run('initiate-transfer', async () => {
			const admin = createSupabaseAdmin();

			try {
				// (c) No unit conversion: Paystack's `amount` is the currency subunit,
				// which for KES is cents, and the column is already integer KES cents.
				const transfer = await getPaystackClient().initiateTransfer({
					amountKesCents: claim.amountKesCents,
					recipientCode: claim.recipientCode,
					// (P7) The payout UUID IS the reference, so this call is safe to repeat.
					reference: claim.reference
				});
				return { outcome: 'initiated', transferCode: transfer.transferCode };
			} catch (err) {
				if (!(err instanceof PaystackApiError)) {
					// Network, timeout, anything unclassified — infrastructure. Throw so
					// Inngest retries; the reference makes that safe.
					throw err;
				}

				// (d) Paystack refusing a reference it has already seen means the
				// transfer EXISTS. For the initiation step that is success, and
				// re-sending would be the actual error.
				if (err.isDuplicateReference) {
					console.info(
						'[payouts] payout %s already initiated at Paystack (duplicate reference) — treating as initiated',
						payoutId
					);
					return { outcome: 'already_initiated' };
				}

				// (e) A genuine rejection. The reason goes to the logs only: payout rows
				// are immutable beyond status (P3) and this phase adds no column for it.
				console.error(
					'[payouts] Paystack rejected transfer for payout %s (HTTP %d): %s',
					payoutId,
					err.status,
					err.paystackMessage
				);

				const { error: failError } = await admin.rpc('transition_payout_status', {
					p_payout_id: payoutId,
					p_new_status: 'failed'
				});
				// If we cannot even record the failure, retry — leaving the row stuck at
				// 'processing' would hold the seller's balance hostage (P9 only releases
				// it once the row reads failed/reversed).
				if (failError) {
					throw new Error(`transition to failed after rejection failed: ${failError.message}`, {
						// Keep the Paystack rejection attached: the transition failure is the
						// symptom, but the rejection is what a reader needs to diagnose it.
						cause: err
					});
				}

				return { outcome: 'failed', reason: err.paystackMessage };
			}
		});

		// (f) Note what is absent: nothing here sets 'success'. That transition is
		// Section 8's, and only after a webhook AND a direct verify agree (P8).
		return { payoutId, ...result };
	}
);

/**
 * The free weekly payout sweep (Payouts PRD — Section 9; P5, P6, P10, A2).
 *
 * The FIRST cron-triggered function in this codebase — every other one reacts to
 * an event. In inngest v4 a schedule is just another entry in `triggers`, so the
 * registration shape is unchanged; what is new is that Inngest, not our code,
 * decides when this runs.
 *
 * A2 — Mondays 06:00 UTC, which is 09:00 EAT: inside Kenyan working hours, so a
 * failed sweep is noticed the same morning rather than over a weekend.
 *
 * Sub-threshold sellers and sellers with no recipient are skipped SILENTLY (P6);
 * their balance simply rolls forward to next Monday. Only counts are logged —
 * a per-seller log line would leak the platform's balance sheet into the run log
 * every week for no operational benefit.
 */
export const payoutWeeklySweep = inngest.createFunction(
	// v4 takes a cron the same way it takes an event: an entry in `triggers`
	// inside the options object, not as a second argument.
	{ id: 'payout-weekly-sweep', retries: 3, triggers: [{ cron: WEEKLY_SWEEP_CRON }] },
	async ({ step }) => {
		// STEP 1 — query and insert. Safe to re-run: the candidates query excludes
		// in-flight sellers, and the partial unique index catches anything that
		// races past it (see runWeeklySweep).
		const sweep = await step.run('create-weekly-payouts', async () =>
			runWeeklySweep(createSupabaseAdmin())
		);

		// STEP 2 — hand every still-pending weekly payout to Section 7.
		//
		// Deliberately NOT just `sweep.payoutIds`: on a retry, rows created by the
		// previous attempt are skipped as in-flight, so their ids are absent from
		// this run's list. Querying for pending weekly rows instead means a sweep
		// that crashed between insert and emit still gets its transfers started.
		const dispatched = await step.run('dispatch-transfers', async () => {
			const admin = createSupabaseAdmin();
			const ids = await pendingWeeklyPayoutIds(admin, sweep.sellerIds);

			for (const payoutId of ids) {
				await inngest.send(payoutRequested.create({ payoutId }));
			}
			return ids.length;
		});

		console.info(
			'[payouts] weekly sweep: %d eligible, %d created, %d skipped in-flight, %d transfers dispatched',
			sweep.eligible,
			sweep.created,
			sweep.skippedInFlight,
			dispatched
		);

		return { ...sweep, dispatched };
	}
);
