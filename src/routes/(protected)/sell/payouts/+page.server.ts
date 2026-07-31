import { fail, redirect } from '@sveltejs/kit';
import { createSupabaseAdmin } from '$lib/server/supabase-admin';
import { getPaystackClient, PaystackApiError } from '$lib/server/paystack';
import { normalizeKenyanPhone } from '$lib/server/mpesa-phone';
import { computeInstantPayoutFee, PAYOUT_HOLD_DAYS } from '$lib/server/payout-constants';
import {
	PAYOUT_REJECTION_MESSAGES,
	decidePayoutRequest,
	isInFlightViolation
} from '$lib/server/payout-request';
import { inngest, payoutRequested } from '$lib/server/inngest';
import type { Actions, PageServerLoad } from './$types';

/**
 * Seller payouts (Payouts PRD — Sections 5 and 6).
 *
 * Lives under /sell so it inherits that group's role guard; no duplicate check
 * here, matching /sell/sales.
 *
 * READS go through the SESSION client under RLS (PR-8 amendment). `authenticated`
 * holds SELECT on payout_recipients and payouts, scoped by the seller-owned
 * policies, and EXECUTE on both balance functions — which are SECURITY INVOKER,
 * so RLS scopes them to the caller's own rows. A seller therefore cannot read or
 * compute anything but their own figures, and no service-role escalation is
 * warranted for a read.
 *
 * WRITES go through the service role, because no client role holds INSERT or
 * DELETE on either table — by privilege, not merely by policy.
 */
export const load: PageServerLoad = async ({ locals: { supabase, user } }) => {
	// The hold boundary, computed once so the tranche query and the display agree.
	const holdCutoff = new Date(Date.now() - PAYOUT_HOLD_DAYS * 86_400_000);

	const [recipientResult, availableResult, pendingResult, historyResult, heldOrdersResult] =
		await Promise.all([
			supabase
				.from('payout_recipients')
				.select('phone_masked, created_at')
				.eq('seller_id', user!.id)
				.maybeSingle(),
			supabase.rpc('seller_available_balance', { p_seller_id: user!.id }),
			supabase.rpc('seller_pending_balance', { p_seller_id: user!.id }),
			supabase
				.from('payouts')
				.select(
					'id, amount_kes_cents, fee_kes_cents, transfer_amount_kes_cents, origin, status, created_at'
				)
				.eq('seller_id', user!.id)
				.order('created_at', { ascending: false }),
			// Held orders, for the release schedule. PR-4: 'completed' only — a 'paid'
			// order is not earned yet and is deliberately absent from this query.
			supabase
				.from('orders')
				.select('seller_net, completed_at')
				.eq('seller_id', user!.id)
				.eq('status', 'completed')
				.gt('completed_at', holdCutoff.toISOString())
				.order('completed_at', { ascending: true })
		]);

	const availableKesCents = Number(availableResult.data ?? 0);
	const pendingKesCents = Number(pendingResult.data ?? 0);

	// Group held earnings by the DAY they release, so the seller sees
	// "KES X available from <date>" per tranche rather than one opaque total.
	// seller_pending_balance stays authoritative for the headline figure; these
	// rows only schedule it.
	const releaseByDate = new Map<string, number>();
	for (const order of heldOrdersResult.data ?? []) {
		if (!order.completed_at) continue;
		const releaseAt = new Date(
			new Date(order.completed_at).getTime() + PAYOUT_HOLD_DAYS * 86_400_000
		);
		// Key by calendar day: two orders confirmed hours apart release the same day
		// and should read as one line, not two.
		const key = releaseAt.toISOString().slice(0, 10);
		releaseByDate.set(key, (releaseByDate.get(key) ?? 0) + (order.seller_net ?? 0));
	}
	const releases = [...releaseByDate.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([releaseOn, amountKesCents]) => ({ releaseOn, amountKesCents }));

	return {
		recipient: recipientResult.data
			? {
					phoneMasked: recipientResult.data.phone_masked,
					createdAt: recipientResult.data.created_at
				}
			: null,
		availableKesCents,
		pendingKesCents,
		holdDays: PAYOUT_HOLD_DAYS,
		/** When each tranche of held money becomes withdrawable. */
		releases,
		// Rendered server-side beside the button so the seller sees the cost before
		// submitting, not after (Section 6 task 2).
		instantFeeKesCents: computeInstantPayoutFee(availableKesCents),
		instantNetKesCents: availableKesCents - computeInstantPayoutFee(availableKesCents),
		history: (historyResult.data ?? []).map((p) => ({
			id: p.id,
			amountKesCents: p.amount_kes_cents,
			feeKesCents: p.fee_kes_cents,
			// Generated column, so the type is nullable even though it never is in
			// practice — it is `amount - fee` and both are NOT NULL.
			netKesCents: p.transfer_amount_kes_cents ?? p.amount_kes_cents - p.fee_kes_cents,
			origin: p.origin,
			status: p.status,
			createdAt: p.created_at
		}))
	};
};

export const actions: Actions = {
	/**
	 * Register or replace the seller's Mpesa payout destination.
	 *
	 * A plain POST form action: no JS required, works pre-hydration.
	 */
	saveRecipient: async ({ request, locals: { supabase, user } }) => {
		const form = await request.formData();
		const rawPhone = String(form.get('phone') ?? '');

		const normalized = normalizeKenyanPhone(rawPhone);
		if (!normalized.ok) {
			// Echo the input back so the seller can correct it rather than retype it.
			return fail(400, { phone: rawPhone, formError: normalized.error });
		}

		const { data: profile } = await supabase
			.from('profiles')
			.select('full_name')
			.eq('id', user!.id)
			.maybeSingle();

		let recipientCode: string;
		try {
			const paystack = getPaystackClient();
			const created = await paystack.createTransferRecipient({
				accountNumber: normalized.msisdn,
				name: profile?.full_name || 'MySoko seller'
			});
			recipientCode = created.recipientCode;
		} catch (err) {
			// Paystack rejecting the number is the seller's problem to fix; anything
			// else is ours, and the seller should be told to retry rather than to
			// re-check a number that is probably fine.
			const message =
				err instanceof PaystackApiError && err.isTerminal
					? 'Paystack could not register that number. Check it and try again.'
					: 'Could not reach Paystack just now. Try again in a moment.';
			console.error('[payouts] createTransferRecipient failed for %s: %s', user!.id, err);
			return fail(502, { phone: rawPhone, formError: message });
		}

		if (!recipientCode) {
			console.error('[payouts] Paystack returned an empty recipient_code for %s', user!.id);
			return fail(502, {
				phone: rawPhone,
				formError: 'Could not reach Paystack just now. Try again in a moment.'
			});
		}

		// Service role: no client role holds INSERT or DELETE here (PR-6/PR-8).
		const admin = createSupabaseAdmin();

		// Replacement is delete+insert, so the unique index on seller_id stays the
		// guarantee rather than an upsert's assumption. The old code is logged for
		// the audit trail and deliberately NOT retained anywhere.
		const { data: existing } = await admin
			.from('payout_recipients')
			.select('paystack_recipient_code')
			.eq('seller_id', user!.id)
			.maybeSingle();

		if (existing) {
			console.info(
				'[payouts] replacing recipient for %s: %s -> %s',
				user!.id,
				existing.paystack_recipient_code,
				recipientCode
			);
			const { error: delError } = await admin
				.from('payout_recipients')
				.delete()
				.eq('seller_id', user!.id);
			if (delError) {
				console.error('[payouts] recipient delete failed for %s: %s', user!.id, delError.message);
				return fail(500, {
					phone: rawPhone,
					formError: 'Could not save that number. Try again in a moment.'
				});
			}
		}

		const { error: insError } = await admin.from('payout_recipients').insert({
			seller_id: user!.id,
			paystack_recipient_code: recipientCode,
			// Only the masked form is stored. The full MSISDN went to Paystack and
			// is not retained (P1).
			phone_masked: normalized.masked
		});

		if (insError) {
			console.error('[payouts] recipient insert failed for %s: %s', user!.id, insError.message);
			return fail(500, {
				phone: rawPhone,
				formError: 'Could not save that number. Try again in a moment.'
			});
		}

		// POST-redirect-get so a refresh cannot re-submit. No query flag: success is
		// a toast on the JS path, and on the no-JS path the rendered masked number
		// is the confirmation.
		redirect(303, '/sell/payouts');
	},

	/**
	 * Instant withdrawal of the full available balance (P5, A1).
	 *
	 * A plain POST form with no amount input — the whole balance goes, so there is
	 * nothing for the seller to type and nothing for a forged POST to tamper with.
	 */
	withdrawNow: async ({ locals: { user } }) => {
		const admin = createSupabaseAdmin();

		// (a) Recompute server-side. The figure rendered on the page is a display of
		// a value that may be minutes old; a withdrawal must act on the balance as
		// it is NOW. service_role bypasses RLS, so this is the authoritative read.
		const { data: balanceData, error: balanceError } = await admin.rpc('seller_available_balance', {
			p_seller_id: user!.id
		});
		if (balanceError) {
			console.error('[payouts] balance read failed for %s: %s', user!.id, balanceError.message);
			return fail(500, { withdrawError: 'Could not check your balance. Try again in a moment.' });
		}

		const { data: recipient } = await admin
			.from('payout_recipients')
			.select('paystack_recipient_code')
			.eq('seller_id', user!.id)
			.maybeSingle();

		// (b) Validate. Below-minimum and no-recipient are decided here; in-flight is
		// left to the unique index below, which is the only guard a concurrent
		// request cannot slip past.
		const decision = decidePayoutRequest({
			availableKesCents: Number(balanceData ?? 0),
			recipientCode: recipient?.paystack_recipient_code
		});

		if (decision.action === 'reject') {
			return fail(400, { withdrawError: PAYOUT_REJECTION_MESSAGES[decision.rejection] });
		}

		// (c) The id is generated here rather than by the column default, because
		// paystack_transfer_reference must equal it (P7) and a column default cannot
		// reference another column of the same row.
		const payoutId = crypto.randomUUID();

		const { error: insertError } = await admin.from('payouts').insert({
			id: payoutId,
			seller_id: user!.id,
			amount_kes_cents: decision.amountKesCents,
			fee_kes_cents: decision.feeKesCents,
			recipient_code: decision.recipientCode,
			paystack_transfer_reference: payoutId,
			origin: 'instant'
		});

		if (insertError) {
			// P10 — the partial unique index is the authoritative in-flight guard.
			// Catching it here turns a race into a clear message rather than a 500.
			if (isInFlightViolation(insertError)) {
				return fail(409, { withdrawError: PAYOUT_REJECTION_MESSAGES.in_flight });
			}
			console.error('[payouts] payout insert failed for %s: %s', user!.id, insertError.message);
			return fail(500, {
				withdrawError: 'Could not start that withdrawal. Try again in a moment.'
			});
		}

		// (d) Hand off to Section 7's transfer initiation. Best-effort, matching the
		// checkout/order.paid precedent: the row exists and is 'pending' either way,
		// and the weekly sweep is not the recovery path here — a stuck pending row is
		// visible in the seller's own history, which is where a support question
		// would start.
		try {
			await inngest.send(payoutRequested.create({ payoutId }));
		} catch (err) {
			console.error(
				'[payouts] payout %s created but payout/requested failed to send: %s',
				payoutId,
				err instanceof Error ? err.message : String(err)
			);
		}

		redirect(303, '/sell/payouts');
	}
};
