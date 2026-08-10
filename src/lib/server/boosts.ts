import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '$lib/types/database';
import { getPaystackClient, type PaystackClient } from '$lib/server/paystack';
import { verifyTransactionOrThrow } from '$lib/server/payment-processing';
import {
	BOOST_REFERENCE_PREFIX,
	decideBoost,
	expectedMinorUnits,
	type BoostDecision,
	type DecisionBoost
} from '$lib/server/boost-decision';
import { createSupabaseAdmin } from '$lib/server/supabase-admin';
import { boostActivated, inngest } from '$lib/server/inngest';

/**
 * Paid listing boosts — purchase and settlement (Boosts PRD — Section 3).
 *
 * ⚠️ SERVER-ONLY.
 *
 * BST-11 SEGREGATION, stated where someone editing this file will read it: a
 * boost is PLATFORM revenue. Nothing in this module writes to `orders`, and
 * nothing may ever be added that does. The payout ledger derives exclusively
 * from `orders.seller_net` on completed orders (`seller_available_balance`), so
 * "creates no order" is the whole of the segregation — there is no filter to
 * maintain, only an absence to preserve. The Section 7 test asserts that absence
 * by checking a seller's available balance is unchanged across a full purchase.
 */

type DB = SupabaseClient<Database>;

export interface BoostPackage {
	id: string;
	duration_days: number;
	/** Whole shillings (BST-3). */
	price_kes: number;
}

/**
 * The purchasable tiers, cheapest first.
 *
 * Read through the CALLER'S client: `boost_packages_select` scopes it to
 * `active`, so a retired tier is invisible to the picker without this query
 * having to know that.
 */
export async function listBoostPackages(supabase: DB): Promise<BoostPackage[]> {
	const { data } = await supabase
		.from('boost_packages')
		.select('id, duration_days, price_kes')
		.order('duration_days', { ascending: true });
	return data ?? [];
}

export type StartBoostResult =
	{ ok: true; authorizationUrl: string; boostId: string } | { ok: false; error: string };

/**
 * Validate eligibility, create the pending ledger row, and hand back the URL to
 * redirect the seller to (Section 3.1).
 *
 * Mirrors `startCheckout`: guards duplicate what the database enforces so the
 * failure surfaces as a friendly toast rather than a raw Postgres error, and the
 * database remains the authority either way — `boosts_verify_eligibility`
 * re-checks ownership and active status at INSERT, and would raise P0001 if this
 * function's checks were ever wrong or bypassed.
 */
export async function startBoostPurchase(
	/** The caller's session client. RLS scopes every read below to what they may see. */
	supabase: DB,
	user: { id: string; email?: string },
	/** From `getProfileRole`. BST-4's role gate is a fact about the caller, not the row. */
	role: string | null,
	listingId: string,
	packageId: string,
	callbackUrl: string,
	/** Injectable so the rollback path is testable without a live Paystack. */
	paystack: PaystackClient = getPaystackClient(),
	/** Injectable for tests; `authenticated` holds no INSERT on boosts (42501). */
	admin: DB = createSupabaseAdmin()
): Promise<StartBoostResult> {
	if (!user.email) {
		return { ok: false, error: 'Add an email address to your account before buying a boost.' };
	}

	// BST-4's role gate, literally: `role = 'seller'`. Admins are deliberately NOT
	// included even though the /sell layout admits them — an admin boosting a
	// listing is not a flow this phase has, and the admin boost surface is
	// explicitly deferred (Section 6.3).
	if (role !== 'seller') {
		return { ok: false, error: 'Only sellers can boost a listing.' };
	}

	const { data: listing } = await supabase
		.from('listings')
		.select('id, seller_id, status, title')
		.eq('id', listingId)
		.maybeSingle();

	if (!listing) return { ok: false, error: 'This listing is no longer available.' };
	if (listing.seller_id !== user.id) return { ok: false, error: 'This is not your listing.' };
	// BST-4 — active at purchase time, and nothing else. `sold` and `deleted` both
	// fail here, which is also what makes BST-10 a non-event: a listing that dies
	// LATER keeps its boost, inert, because it has already left every result set.
	if (listing.status !== 'active') {
		return { ok: false, error: 'Only an active listing can be boosted.' };
	}

	// RLS shows only active packages, so a retired tier reads as missing.
	const { data: pkg } = await supabase
		.from('boost_packages')
		.select('id, duration_days, price_kes')
		.eq('id', packageId)
		.maybeSingle();

	if (!pkg) return { ok: false, error: 'That boost package is no longer available.' };

	// BST-14 / D10 — the reference is OURS, generated before Paystack sees the
	// transaction and unique-indexed. It is both the idempotency key and the
	// webhook's routing discriminator.
	const reference = `${BOOST_REFERENCE_PREFIX}${crypto.randomUUID()}`;

	// BST-3 — snapshot price AND duration. The row must describe what was bought
	// even if the tier is retired or re-priced a minute later.
	const { data: boost, error: insertError } = await admin
		.from('boosts')
		.insert({
			listing_id: listing.id,
			seller_id: user.id,
			package_id: pkg.id,
			price_kes_charged: pkg.price_kes,
			duration_days: pkg.duration_days,
			paystack_reference: reference
		})
		.select('id')
		.single();

	if (insertError || !boost) {
		// The eligibility trigger is the real gate; this is its friendly face.
		console.error(
			'[boosts] could not create pending boost for listing %s',
			listing.id,
			insertError
		);
		return { ok: false, error: 'Could not start the boost purchase. Please try again.' };
	}

	try {
		const initialized = await paystack.initializeTransaction({
			email: user.email,
			// The BST-3 conversion, one of exactly two places shillings become minor
			// units. The other is the verify comparison in `decideBoost`.
			amountCents: expectedMinorUnits(pkg.price_kes),
			reference,
			callbackUrl,
			// BST-14 — dashboard label only. Nothing reads this back.
			metadata: {
				kind: 'boost',
				boost_id: boost.id,
				listing_id: listing.id,
				listing_title: listing.title,
				duration_days: pkg.duration_days
			}
		});

		if (!initialized.authorizationUrl) throw new Error('Paystack returned no authorization_url');
		return { ok: true, authorizationUrl: initialized.authorizationUrl, boostId: boost.id };
	} catch (err) {
		// Roll the row forward to a terminal state rather than leaving a pending
		// purchase nobody will ever settle. Unlike checkout's rollback there is
		// nothing to release — a pending boost holds no resource and blocks no one —
		// so this is bookkeeping, and a failure to record it is not fatal.
		console.error('[boosts] Paystack initialize failed for boost %s', boost.id, err);
		const { error: failError } = await admin.rpc('transition_boost_status', {
			p_boost_id: boost.id,
			p_new_status: 'failed'
		});
		if (failError) {
			console.error('[boosts] could not mark boost %s failed', boost.id, failError);
		}
		return { ok: false, error: 'Could not reach Paystack. Please try again.' };
	}
}

export type BoostOutcome =
	| 'activated'
	| 'charge_failed'
	| 'noop_already_settled'
	| 'ignored_unmatched'
	| 'ignored_amount_mismatch'
	| 'verify_inconclusive';

export interface BoostProcessResult {
	outcome: BoostOutcome;
	boostId: string | null;
	reason?: string;
	/** Undefined when verify was unreachable — not the same as a decline. */
	verifyStatus?: string;
	/** Set only on activation, for the caller that renders the confirmation. */
	expiresAt?: string | null;
}

export interface BoostProcessDeps {
	paystack: Pick<PaystackClient, 'verifyTransaction'>;
	/** MUST be the service-role client: authenticated holds no write on boosts. */
	admin: DB;
	/** Emits `boost/activated`. Injectable for tests; defaults to the real client. */
	sendBoostActivated?: (input: { boostId: string; expiresAt: string }) => Promise<void>;
}

async function emitBoostActivated(input: { boostId: string; expiresAt: string }): Promise<void> {
	await inngest.send(boostActivated.create(input));
}

/** True when the database refused a transition — always a no-op, never an error. */
function isInvalidTransition(message: string | undefined): boolean {
	return !!message && message.includes('invalid_boost_transition');
}

/** Why an expiry attempt did nothing. None of these no-ops is an error. */
export type ExpireOutcome =
	| 'expired'
	/** The row was already terminal — a newer purchase superseded it (BST-5). */
	| 'noop_superseded'
	/** The window has not closed yet; the guard refused to un-boost early (BST-9). */
	| 'noop_not_due'
	/** The row is gone. Surprising, but nothing to retry towards — see below. */
	| 'unknown_boost';

/**
 * Close one boost's window (Section 4.2).
 *
 * Extracted from the Inngest function so the branch that matters — a superseded
 * job doing nothing — is testable without a scheduler, the same way
 * `runWeeklySweep` is.
 *
 * NOTE ON THE DESIGN vs the PRD's sketch. Section 4.2 describes the job re-reading
 * the listing's effective expiry and deciding for itself whether it has been
 * superseded. That read is unnecessary here, because supersession is EAGER: an
 * extension moves the incumbent to `expired` inside the same transaction that
 * activates its replacement (BST-5, in `transition_boost_status`). So a superseded
 * job's row is already terminal when it wakes, and the graph refuses it — which is
 * the amended BST-12's "SQL predicates as the idempotency guarantee", rather than
 * a job comparing timestamps and hoping it read them at the right moment.
 */
export async function expireBoost(admin: DB, boostId: string): Promise<ExpireOutcome> {
	const { error } = await admin.rpc('transition_boost_status', {
		p_boost_id: boostId,
		p_new_status: 'expired'
	});

	if (!error) return 'expired';
	if (isInvalidTransition(error.message)) return 'noop_superseded';
	if (error.message.includes('boost_not_yet_expired')) return 'noop_not_due';

	// The row is gone — deleted by an operator clearing test data, or by the e2e
	// teardown. LOUD BUT TERMINAL, exactly as payoutInitiateTransfer treats an
	// event for a payout it cannot find: retrying cannot bring the row back, so
	// throwing here would burn three attempts and leave a failed run in the
	// dashboard for something whose answer is already final. The console.error is
	// what makes it visible; the clean return is what stops it being noise.
	//
	// This path became reachable the first time production boost rows were
	// deleted (2026-08-11). Before that it was theoretical, and throwing looked
	// like the conservative choice.
	if (error.message.includes('boost_not_found')) {
		console.error(
			'[boosts] expiry woke for boost %s, which no longer exists — nothing to expire',
			boostId
		);
		return 'unknown_boost';
	}

	// Anything else is infrastructure — throw so Inngest retries.
	throw new Error(`transition_boost_status(expired) failed: ${error.message}`);
}

/**
 * Append one row to the shared Paystack audit trail (D9).
 *
 * `payments` is the Paystack trail, not the orders trail — it already records
 * transfer events with no order attached — so boost charges belong here too, and
 * `order_id` is null for every one of them. That null is itself the BST-11
 * evidence: a boost charge is visibly not an order.
 */
async function appendBoostAudit(
	admin: DB,
	row: { paystack_reference: string; event_type: string; payload: Json; outcome: string }
): Promise<void> {
	const { error } = await admin.from('payments').insert({
		order_id: null,
		paystack_reference: row.paystack_reference,
		event_type: row.event_type,
		payload: row.payload,
		// Prefixed so a reader scanning `payments` can tell at a glance which flow
		// wrote the row, without joining anything.
		processing_outcome: `boost_${row.outcome}`,
		signature_valid: true
	});
	if (error) throw new Error(`boost audit insert failed: ${error.message}`);
}

/**
 * Settle one `boost_` reference to a terminal outcome (Section 3.2–3.4).
 *
 * Run by BOTH the Inngest function and the seller's callback page. Business
 * outcomes RETURN; infrastructure failures THROW so the caller's retry applies —
 * the same split `processPaymentReference` uses.
 *
 * Idempotent three times over, deliberately: `decideBoost` short-circuits a
 * non-pending row, `transition_boost_status` enforces the graph in SQL, and the
 * `invalid_boost_transition` catch below turns a lost race into a no-op. A
 * duplicate webhook cannot double-extend a boost.
 */
export async function processBoostReference(
	reference: string,
	deps: BoostProcessDeps
): Promise<BoostProcessResult> {
	const { paystack, admin } = deps;

	const verify = await verifyTransactionOrThrow(paystack, reference);

	const { data: boost, error: boostError } = await admin
		.from('boosts')
		.select('id, status, price_kes_charged, expires_at')
		.eq('paystack_reference', reference)
		.maybeSingle();
	if (boostError) throw new Error(`boost lookup failed: ${boostError.message}`);

	const decision: BoostDecision = decideBoost(verify, boost as DecisionBoost | null);
	const payload: Json = (verify?.raw as Json) ?? { error: 'verify_unavailable', reference };

	if (decision.action === 'stop' || decision.action === 'noop') {
		if (decision.action === 'stop' && decision.outcome === 'ignored_amount_mismatch') {
			console.error(
				'[boosts] AMOUNT MISMATCH for %s — %s. Boost NOT activated.',
				reference,
				decision.reason
			);
		}
		if (decision.action === 'stop' && decision.outcome === 'ignored_unmatched') {
			// The namespace is ours and unique-indexed, so this should be unreachable.
			console.error('[boosts] no boost row for our own reference %s', reference);
		}
		await appendBoostAudit(admin, {
			paystack_reference: reference,
			event_type: 'verify',
			payload,
			outcome: decision.outcome
		});
		return {
			outcome: decision.outcome,
			boostId: boost?.id ?? null,
			reason: decision.action === 'stop' ? decision.reason : undefined,
			verifyStatus: verify?.status
		};
	}

	if (decision.action === 'fail') {
		const { error } = await admin.rpc('transition_boost_status', {
			p_boost_id: boost!.id,
			p_new_status: 'failed'
		});
		// A refusal means someone else settled it first — a no-op, not an error.
		if (error && !isInvalidTransition(error.message)) {
			throw new Error(`transition_boost_status(failed) failed: ${error.message}`);
		}
		await appendBoostAudit(admin, {
			paystack_reference: reference,
			event_type: 'verify',
			payload,
			outcome: decision.outcome
		});
		// No listing state changes on a failed charge (Section 3.2).
		return {
			outcome: decision.outcome,
			boostId: boost!.id,
			reason: decision.reason,
			verifyStatus: verify?.status
		};
	}

	// Verified and proceeding. Activation computes the BST-5 window, supersedes any
	// incumbent, and (through the sync trigger) sets listings.boosted_until.
	const { data: activated, error: activateError } = await admin.rpc('transition_boost_status', {
		p_boost_id: boost!.id,
		p_new_status: 'active'
	});

	if (activateError) {
		if (isInvalidTransition(activateError.message)) {
			// Lost the race to a concurrent webhook/callback. The other side did
			// exactly this work; recording a second activation would be a lie.
			await appendBoostAudit(admin, {
				paystack_reference: reference,
				event_type: 'verify',
				payload,
				outcome: 'noop_already_settled'
			});
			return {
				outcome: 'noop_already_settled',
				boostId: boost!.id,
				verifyStatus: verify?.status
			};
		}
		throw new Error(`transition_boost_status(active) failed: ${activateError.message}`);
	}

	const row = activated as unknown as { expires_at: string | null } | null;
	const expiresAt = row?.expires_at ?? null;

	await appendBoostAudit(admin, {
		paystack_reference: reference,
		event_type: 'activate',
		payload: (activated as Json) ?? payload,
		outcome: decision.outcome
	});

	// Start the expiry countdown (Section 4). Emitted HERE rather than in the
	// Inngest function because this is the shared chokepoint — the callback page
	// settles boosts without any Inngest event of its own.
	//
	// Best-effort, and the consequence is genuinely small: if this never lands,
	// the row keeps reading 'active' forever, but the LISTING still stops being
	// elevated on time, because the ranking predicate is `boosted_until > now()`
	// (BST-9's structural safeguard). A lost event costs tidy bookkeeping, not a
	// permanently boosted listing.
	if (expiresAt) {
		try {
			await (deps.sendBoostActivated ?? emitBoostActivated)({ boostId: boost!.id, expiresAt });
		} catch (err) {
			console.error(
				'[boosts] boost %s activated but boost/activated failed to send: %s. ' +
					'Its status will not be tidied to expired; elevation still ends at %s.',
				boost!.id,
				err instanceof Error ? err.message : String(err),
				expiresAt
			);
		}
	}

	return {
		outcome: 'activated',
		boostId: boost!.id,
		verifyStatus: verify?.status,
		expiresAt
	};
}
