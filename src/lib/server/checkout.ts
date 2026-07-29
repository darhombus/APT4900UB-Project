import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { createSupabaseAdmin } from '$lib/server/supabase-admin';
import { getPaystackClient, type PaystackClient } from '$lib/server/paystack';
import { inngest, orderCreated } from '$lib/server/inngest';

/**
 * Server-side checkout data layer (Checkout PRD — Section 4).
 *
 * Nothing here trusts the client: the amount comes from `create_pending_order`
 * (which derives it from the listing's stored price), the reference is ours, and
 * every order write goes through a security-definer function or the service-role
 * client. The client role holds SELECT on `orders` and nothing else (R-9).
 */

type DB = SupabaseClient<Database>;

/** At most one can exist per listing — the partial unique index guarantees it (D3). */
export interface PendingHold {
	id: string;
	buyer_id: string;
	paystack_authorization_url: string | null;
}

/**
 * The pending hold on a listing, if any.
 *
 * Read with the SERVICE-ROLE client on purpose. `orders_select` only exposes an
 * order to its buyer and seller, but D3 requires every *other* viewer to see
 * "Checkout in progress" — an RLS-bound read would return nothing for them and
 * the button would wrongly invite a purchase that `create_pending_order` is
 * about to reject. Deliberate and minimal: three columns, scoped to one listing,
 * and the caller-facing shape below never exposes the holder's identity.
 * (Same pattern as `fetchListingMeta` in $lib/server/messaging.)
 */
export async function findPendingHold(listingId: string): Promise<PendingHold | null> {
	const admin = createSupabaseAdmin();
	const { data } = await admin
		.from('orders')
		.select('id, buyer_id, paystack_authorization_url')
		.eq('listing_id', listingId)
		.eq('status', 'pending_payment')
		.maybeSingle();
	return data ?? null;
}

/** What the listing page needs to render the Buy Now area — no holder identity. */
export type CheckoutHold =
	{ heldByMe: true; orderId: string; authorizationUrl: string | null } | { heldByMe: false };

/** Narrow a hold to the shape safe to send to the browser. */
export function toCheckoutHold(hold: PendingHold | null, viewerId: string | undefined) {
	if (!hold) return null;
	if (viewerId && hold.buyer_id === viewerId) {
		return {
			heldByMe: true as const,
			orderId: hold.id,
			authorizationUrl: hold.paystack_authorization_url
		};
	}
	// Someone else holds it. The viewer learns only that, never who.
	return { heldByMe: false as const };
}

export type StartCheckoutResult =
	{ ok: true; authorizationUrl: string; orderId: string } | { ok: false; error: string };

/**
 * Create the hold, initialize the Paystack transaction, and hand back the URL to
 * redirect the buyer to. Guards duplicate `create_pending_order`'s own checks so
 * failures surface as friendly toasts rather than raw Postgres errors — the
 * database remains the authority either way.
 */
export async function startCheckout(
	supabase: DB,
	user: { id: string; email?: string },
	listingId: string,
	callbackUrl: string,
	/** Injectable so the rollback path can be tested without a live Paystack. */
	paystack: PaystackClient = getPaystackClient()
): Promise<StartCheckoutResult> {
	if (!user.email) {
		return { ok: false, error: 'Add an email address to your account before buying.' };
	}

	const { data: listing } = await supabase
		.from('listings')
		.select('id, seller_id, status')
		.eq('id', listingId)
		.maybeSingle();

	if (!listing) return { ok: false, error: 'This listing is no longer available.' };
	if (listing.seller_id === user.id) return { ok: false, error: 'This is your own listing.' };
	if (listing.status !== 'active') {
		return { ok: false, error: "This listing isn't available to buy." };
	}

	// D10 — the reference is OURS, generated before Paystack sees the transaction
	// and unique-indexed on the order. It is the idempotency key that makes the
	// webhook and the callback safe to both process the same payment.
	const reference = `msk_${crypto.randomUUID()}`;

	// `create_pending_order` returns the orders row itself (not a set), so there is
	// no .single() here — adding one narrows the result type to `never`.
	const { data: order, error: createError } = await supabase.rpc('create_pending_order', {
		p_listing_id: listingId,
		p_reference: reference
	});

	if (createError || !order) {
		// The partial unique index is the real gate; this is its friendly face.
		if (createError?.message?.includes('listing_on_hold')) {
			return {
				ok: false,
				error: 'Someone else is checking out right now. Try again in a few minutes.'
			};
		}
		if (createError?.message?.includes('listing_not_active')) {
			return { ok: false, error: "This listing isn't available to buy." };
		}
		if (createError?.message?.includes('own_listing')) {
			return { ok: false, error: 'This is your own listing.' };
		}
		return { ok: false, error: 'Could not start checkout. Please try again.' };
	}

	let authorizationUrl: string;
	try {
		const initialized = await paystack.initializeTransaction({
			email: user.email,
			amountCents: order.amount_total,
			reference,
			callbackUrl
		});
		authorizationUrl = initialized.authorizationUrl;
		if (!authorizationUrl) throw new Error('Paystack returned no authorization_url');
	} catch (err) {
		// Release the hold we just took — an orphaned pending order would block
		// this listing for every other buyer until it expired. The caller is the
		// buyer, so cancel_pending_order accepts them.
		console.error('[checkout] Paystack initialize failed; rolling back the hold', err);
		const { error: rollbackError } = await supabase.rpc('cancel_pending_order', {
			p_order_id: order.id
		});
		if (rollbackError) {
			console.error(
				'[checkout] rollback FAILED — order %s is an orphaned hold',
				order.id,
				rollbackError
			);
		}
		return { ok: false, error: 'Could not reach Paystack. Please try again.' };
	}

	// Store the URL so the buyer can resume an abandoned payment. Service-role,
	// because no client role may write to orders (R-9).
	const admin = createSupabaseAdmin();
	const { error: urlError } = await admin.rpc('set_order_authorization_url', {
		p_order_id: order.id,
		p_url: authorizationUrl
	});
	if (urlError) {
		// Not fatal: the buyer is about to be redirected there anyway. It only
		// costs them the ability to resume later, so log and continue.
		console.error('[checkout] could not persist authorization_url for %s', order.id, urlError);
	}

	// Starts the 30-minute expiry countdown (D3). Non-fatal by design: if Inngest
	// is unreachable the buyer must still be able to pay. The cost is that this
	// hold won't auto-expire — it can still be cancelled by the buyer.
	try {
		await inngest.send(orderCreated.create({ orderId: order.id }));
	} catch (err) {
		console.error('[checkout] could not emit checkout/order.created for %s', order.id, err);
	}

	return { ok: true, authorizationUrl, orderId: order.id };
}

export type CancelCheckoutResult = { ok: true } | { ok: false; error: string };

/** Buyer releases their own hold. The definer function enforces both conditions. */
export async function cancelCheckout(supabase: DB, orderId: string): Promise<CancelCheckoutResult> {
	const { error } = await supabase.rpc('cancel_pending_order', { p_order_id: orderId });
	if (error) {
		return { ok: false, error: 'That checkout could no longer be cancelled.' };
	}
	return { ok: true };
}
