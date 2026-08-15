import { error, fail, redirect } from '@sveltejs/kit';
import { createSupabaseAdmin } from '$lib/server/supabase-admin';
import { cancelCheckout } from '$lib/server/checkout';
import { findSpokenConversation } from '$lib/server/messaging';
import { deleteReview, findReviewForOrder, insertReview } from '$lib/server/reviews';
import { emitDisputeOpened, emitOrderCompleted } from '$lib/server/notification-events';
import { coverPath, publicUrl } from '$lib/listing-images';
import { parseBody, parseRating } from '$lib/reviews';
import { DISPUTE_ELIGIBLE_ORDER_STATUSES, isDisputeLive, parseDisputeReason } from '$lib/disputes';
import type { Actions, PageServerLoad } from './$types';

/**
 * A buyer's single order (Checkout PRD — Section 9).
 *
 * `commission_amount` and `seller_net` are deliberately NOT selected: the buyer
 * has no business seeing the platform's cut, and not fetching it is a stronger
 * guarantee than fetching it and remembering not to render it.
 */
// One string literal, not a concatenation: supabase-js infers the row type from
// the literal, and `a + b` widens it to `string` (every field then types as
// GenericStringError).
const ORDER_COLUMNS =
	'id, status, buyer_id, seller_id, listing_id, amount_total, paystack_reference, paystack_authorization_url, created_at, paid_at, completed_at, cancelled_at, expired_at';

export const load: PageServerLoad = async ({ params, locals: { supabase, user } }) => {
	// RLS scopes this to orders the caller is party to; the buyer check below
	// makes it the buyer's page specifically. 404 rather than 403 — a seller
	// poking at an order id learns nothing about whether it exists.
	const { data: order } = await supabase
		.from('orders')
		.select(ORDER_COLUMNS)
		.eq('id', params.id)
		.maybeSingle();

	if (!order || order.buyer_id !== user!.id) error(404, 'Order not found');

	// Listing metadata via the service-role client, scoped to this listing. The
	// listing is `sold` by now, and a later soft-delete would hide it from the
	// buyer entirely — an order's record must not stop rendering because of that.
	// (Same deliberate, minimal read as $lib/server/messaging's fetchListingMeta.)
	const admin = createSupabaseAdmin();
	const { data: listing } = await admin
		.from('listings')
		.select('id, title, status, listing_images(storage_path, position)')
		.eq('id', order.listing_id)
		.maybeSingle();

	const cover = listing ? coverPath(listing.listing_images) : null;

	// Messaging gating, mirroring startConversation: a NEW conversation needs an
	// ACTIVE listing, but an existing thread stays writable on a sold listing
	// (messaging D3). So: link to the thread if one exists; otherwise offer to
	// start one only while the listing is still active; otherwise hide the link
	// rather than presenting a dead end.
	const conversationId = await findSpokenConversation(supabase, order.listing_id, user!.id);
	const messageHref = conversationId
		? `/messages/${conversationId}`
		: listing?.status === 'active'
			? `/listings/${order.listing_id}`
			: null;

	// Reviews (Section 4.2). `canReview` is UX only — RLS and the unique
	// constraint are the enforcement, and this flag exists so the page does not
	// offer a form that is certain to fail. A HIDDEN review still comes back here
	// via the author carve-out in reviews_select, which is what lets the page say
	// so rather than silently re-offering the form.
	const review = order.status === 'completed' ? await findReviewForOrder(supabase, order.id) : null;

	// Disputes (ADM-1). Read through the SESSION client: disputes_select admits
	// the buyer twice over — `opened_by = auth.uid()` and `dispute_party(order_id)`
	// — so no service-role read is needed to show someone their own dispute.
	//
	// Every dispute for this order, newest first, not just the live one: ADM-1
	// allows a second dispute after the first is settled, and hiding the settled
	// one would make the outcome the buyer was told about disappear.
	const { data: disputeRows } = await supabase
		.from('disputes')
		.select('id, status, reason, resolution_note, created_at, resolved_at')
		.eq('order_id', order.id)
		.order('created_at', { ascending: false });

	const disputes = disputeRows ?? [];
	const liveDispute = disputes.find((d) => isDisputeLive(d.status)) ?? null;

	return {
		review,
		canReview: order.status === 'completed' && review === null,
		disputes,
		/**
		 * UX only — `open_dispute` re-checks the caller, the order status and the
		 * one-live-per-order index, so a forged POST still fails. This flag exists
		 * so the page does not offer a form that is certain to be refused.
		 */
		canOpenDispute:
			(DISPUTE_ELIGIBLE_ORDER_STATUSES as readonly string[]).includes(order.status) &&
			liveDispute === null,
		order: {
			id: order.id,
			status: order.status,
			amountTotal: order.amount_total,
			reference: order.paystack_reference,
			authorizationUrl: order.paystack_authorization_url,
			created_at: order.created_at,
			paid_at: order.paid_at,
			completed_at: order.completed_at,
			cancelled_at: order.cancelled_at,
			expired_at: order.expired_at
		},
		listing: {
			id: order.listing_id,
			title: listing?.title ?? 'Listing no longer available',
			status: listing?.status ?? null,
			coverUrl: cover ? publicUrl(admin, cover) : null,
			// A deleted/removed listing isn't publicly reachable, so don't link to it.
			href:
				listing?.status === 'active' || listing?.status === 'sold'
					? `/listings/${order.listing_id}`
					: null
		},
		messageHref
	};
};

export const actions: Actions = {
	// Buyer confirms receipt: paid → completed. The definer function enforces
	// both the caller and the from-status, so a forged POST can't complete
	// someone else's order or skip the paid step.
	confirmReceipt: async ({ params, locals: { supabase } }) => {
		const { error: rpcError } = await supabase.rpc('complete_order', { p_order_id: params.id });
		if (rpcError) {
			return fail(400, { formError: 'That order could no longer be confirmed.' });
		}
		// ONE OF TWO emission points for this event (Notifications PRD, NTF-17). The
		// other is the auto-complete backstop; there is no shared chokepoint the way
		// `finalized` is for payment, because the buyer's path and the backstop are
		// separate definer functions with separate callers. Emitting from only one
		// would silently notify nobody for every order completed the other way.
		//
		// After the RPC succeeded, so a refused completion notifies nobody. Failure
		// to emit must not fail the action the buyer just took — the order IS
		// completed at this point, and a missing notification is not worth turning
		// that into an error page.
		await emitOrderCompleted(params.id);
		// POST-redirect-get so a refresh can't re-submit.
		redirect(303, `/account/orders/${params.id}`);
	},

	// Buyer releases their own hold — the same path the listing page uses.
	cancelCheckout: async ({ params, locals: { supabase } }) => {
		const result = await cancelCheckout(supabase, params.id);
		if (!result.ok) return fail(400, { formError: result.error });
		redirect(303, `/account/orders/${params.id}`);
	},

	// Section 4 — write the review. Rating and body are validated here so a bad
	// submit comes back as an inline error rather than a constraint violation;
	// the listing/seller/buyer ids are read from the order inside insertReview and
	// are never accepted from the form.
	reviewSubmit: async ({ params, request, locals: { supabase } }) => {
		const form = await request.formData();

		const rating = parseRating(form.get('rating'));
		if (rating === null) {
			return fail(400, { reviewError: 'Choose a rating from 1 to 5 stars.' });
		}

		const body = parseBody(form.get('body'));
		if (!body.ok) {
			return fail(400, { reviewError: 'Keep your review to 1000 characters or fewer.' });
		}

		const result = await insertReview(supabase, params.id, rating, body.value);
		if (!result.ok) return fail(400, { reviewError: result.error });

		// POST-redirect-get, matching confirmReceipt: a refresh must not re-submit.
		redirect(303, `/account/orders/${params.id}`);
	},

	/**
	 * ADM Section 6 — the buyer opens a dispute.
	 *
	 * THIS IS `open_dispute`'S FIRST CALLER. The RPC has held an `authenticated`
	 * EXECUTE grant since the Section 4 push with nothing in the app able to
	 * reach it; this action closes that window.
	 *
	 * The reason is validated here so a short one comes back inline rather than
	 * as a raw CHECK violation, but the RPC re-checks it — along with the caller
	 * being the order's buyer, the order being in a disputable state, and the
	 * one-live-dispute index. Nothing here is the enforcement.
	 */
	openDispute: async ({ params, request, locals: { supabase } }) => {
		const form = await request.formData();
		const reason = parseDisputeReason(form.get('reason'));
		if (!reason.ok) {
			return fail(400, { disputeError: reason.error, disputeReason: reason.value });
		}

		const { data: disputeId, error: rpcError } = await supabase.rpc('open_dispute', {
			p_order_id: params.id,
			p_reason: reason.value
		});

		if (rpcError) {
			// Assert on the CLASS, never on the RPC's own message token — those are
			// for logs. 42501 is authorization, P0002 an absent order, P0001 a rule.
			return fail(400, {
				disputeError:
					rpcError.code === '42501'
						? 'You can only report a problem on your own order.'
						: rpcError.code === 'P0002'
							? 'That order could not be found.'
							: 'This order cannot be disputed right now. Reload to see its current state.',
				disputeReason: reason.value
			});
		}

		// After the RPC succeeded, so a refused dispute notifies nobody — and
		// failure to emit must not fail the action: the dispute IS open at this
		// point, and a missing notification is not worth an error page.
		if (typeof disputeId === 'string') await emitDisputeOpened(disputeId);

		// POST-redirect-get so a refresh can't re-submit.
		redirect(303, `/account/orders/${params.id}`);
	},

	// Section 5 — remove the caller's own review. Deleting frees the order slot
	// (D4), so the load above will offer the form again on the next render.
	reviewDelete: async ({ params, request, locals: { supabase, user } }) => {
		const reviewId = String((await request.formData()).get('reviewId') ?? '');
		if (!reviewId) return fail(400, { reviewError: 'That review could not be removed.' });

		const result = await deleteReview(supabase, reviewId, user!.id);
		if (!result.ok) return fail(400, { reviewError: result.error });

		redirect(303, `/account/orders/${params.id}`);
	}
};
