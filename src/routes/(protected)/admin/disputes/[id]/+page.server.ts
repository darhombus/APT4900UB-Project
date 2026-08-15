import { error, fail } from '@sveltejs/kit';
import { emitDisputeResolved, emitDisputeUnderReview } from '$lib/server/notification-events';
import type { Actions, PageServerLoad } from './$types';

/**
 * One dispute, with the order context an admin needs to decide it.
 *
 * ONE CLIENT. Every table read here — disputes, orders, profiles, listings,
 * conversations, payouts — admits admins through its own RLS, so the session
 * client reads all of them and RLS stays a layer behind the /admin gate.
 *
 * THE BALANCE CALL IS THE DELICATE ONE. seller_available_balance is SECURITY
 * INVOKER, so switching the caller changes whose RLS its sums run under, across
 * three tables at once — orders (a missing arm reads SMALLER), payouts and
 * disputes (a missing arm reads LARGER, since `not exists` is fail-open). None
 * of those throw; each is a wrong number on the surface where an admin decides
 * whether a refund is recoverable. The switch is therefore guarded by an
 * equality test, not by inspection: bst22-admin-arms-and-execute.test.ts asserts
 * both balances are EXACTLY equal read as service_role and as an admin, over a
 * ledger where all three arms are load-bearing.
 *
 * ADM-11 CONTEXT IS THE POINT OF THE PAYOUT BLOCK. While this dispute is live
 * the order's seller_net is excluded from the seller's balance, so the money is
 * still on the platform — unless it was already paid out before the dispute was
 * opened, which ADM-11 records as accepted residual exposure. An admin resolving
 * to refunded needs to know which case they are in BEFORE they act, because the
 * refund itself is manual (ADM-3) and comes out of the platform balance.
 *
 * Payouts are seller-scoped, not order-scoped — there is no payouts.order_id and
 * this phase does not add one. So the page reports the two true figures and says
 * plainly that attribution is not possible, rather than inventing a per-order
 * answer the data cannot support.
 */
export const load: PageServerLoad = async ({ locals: { supabase }, params }) => {
	const { data: dispute } = await supabase
		.from('disputes')
		.select(
			'id, order_id, opened_by, reason, status, refund_reference, resolution_note, resolved_by, created_at, resolved_at'
		)
		.eq('id', params.id)
		.maybeSingle();

	if (!dispute) error(404, 'Not found');

	const { data: order } = await supabase
		.from('orders')
		.select(
			'id, listing_id, buyer_id, seller_id, status, amount_total, commission_amount, seller_net, paystack_reference, created_at, paid_at, completed_at'
		)
		.eq('id', dispute.order_id)
		.maybeSingle();

	const [{ data: parties }, { data: listing }, { data: conversation }, balance, { data: payouts }] =
		await Promise.all([
			supabase
				.from('profiles')
				.select('id, full_name')
				.in('id', [dispute.opened_by, order?.seller_id ?? dispute.opened_by]),
			order
				? supabase
						.from('listings')
						.select('id, title, status')
						.eq('id', order.listing_id)
						.maybeSingle()
				: Promise.resolve({ data: null }),
			// The thread between these two on this listing, if one exists — the
			// fastest way for an admin to see what was actually said.
			order
				? supabase
						.from('conversations')
						.select('id')
						.eq('listing_id', order.listing_id)
						.eq('buyer_id', order.buyer_id)
						.maybeSingle()
				: Promise.resolve({ data: null }),
			order
				? supabase.rpc('seller_available_balance', { p_seller_id: order.seller_id })
				: Promise.resolve({ data: null }),
			order
				? supabase
						.from('payouts')
						.select('amount_kes_cents, status')
						.eq('seller_id', order.seller_id)
						.in('status', ['pending', 'processing', 'success'])
				: Promise.resolve({ data: [] as { amount_kes_cents: number; status: string }[] })
		]);

	const byId = new Map((parties ?? []).map((p) => [p.id, p.full_name]));
	const paidOutCents = (payouts ?? []).reduce((sum, p) => sum + (p.amount_kes_cents ?? 0), 0);

	return {
		dispute,
		order,
		listing,
		conversationId: conversation?.id ?? null,
		buyerName: byId.get(dispute.opened_by) ?? 'Unknown buyer',
		sellerName: order ? (byId.get(order.seller_id) ?? 'Unknown seller') : null,
		payout: {
			// All bigint KES cents (D8); divided at the display edge.
			availableCents: Number(balance?.data ?? balance ?? 0),
			paidOutCents
		}
	};
};

export const actions: Actions = {
	/**
	 * open -> under_review. The RPC is the only writer; ADM-7 gives no role UPDATE
	 * on disputes, so there is no direct-write path to fall back on.
	 */
	review: async ({ locals: { supabase }, params }) => {
		const { error: err } = await supabase.rpc('admin_review_dispute', { p_dispute_id: params.id });
		if (err) {
			return fail(400, { actionError: refusalMessage(err.code, 'review') });
		}
		// ADM-8 → the BUYER. After the RPC succeeded, so a refused transition
		// notifies nobody; and a failed emission must not fail the action, since
		// the dispute IS under review at this point.
		await emitDisputeUnderReview(params.id);
		return { reviewed: true };
	},

	/**
	 * under_review -> resolved_refunded | resolved_rejected.
	 *
	 * ADM-3: the refund happens in the Paystack dashboard FIRST and its reference
	 * is recorded here. The RPC enforces both halves of that rule — a refund
	 * without a reference and a rejection carrying one are both refused — so this
	 * action does not re-implement the validation, it only surfaces the refusal.
	 */
	resolve: async ({ locals: { supabase }, params, request }) => {
		const form = await request.formData();
		const outcome = String(form.get('outcome') ?? '');
		const note = String(form.get('resolutionNote') ?? '').trim();
		const reference = String(form.get('refundReference') ?? '').trim();

		if (outcome !== 'resolved_refunded' && outcome !== 'resolved_rejected') {
			return fail(400, { actionError: 'Choose refund or reject.' });
		}
		if (!note) {
			return fail(400, { actionError: 'Add a short note explaining the decision.' });
		}
		if (outcome === 'resolved_refunded' && !reference) {
			return fail(400, {
				actionError:
					'Record the Paystack refund reference. Perform the refund in the dashboard first.'
			});
		}

		const { error: err } = await supabase.rpc('admin_resolve_dispute', {
			p_dispute_id: params.id,
			p_outcome: outcome,
			p_resolution_note: note,
			p_refund_reference: outcome === 'resolved_refunded' ? reference : undefined
		});
		if (err) {
			return fail(400, { actionError: refusalMessage(err.code, 'resolve') });
		}
		// ADM-8 → BOTH parties, with the buyer/seller wording split carried by the
		// payload.role discriminator inside the handler. The handler re-reads the
		// dispute's status for the outcome rather than trusting the event, so a
		// replay cannot announce a decision that has since changed.
		await emitDisputeResolved(params.id);
		return { resolved: true };
	}
};

/**
 * The RPCs raise stable SQLSTATEs (42501 authorization, P0001 rule, P0002
 * absent). Mapped to plain sentences here rather than shown raw — and never by
 * matching the message token, which is for logs.
 */
function refusalMessage(code: string | undefined, verb: 'review' | 'resolve'): string {
	if (code === '42501') return 'Your account cannot act on disputes.';
	if (code === 'P0002') return 'That dispute no longer exists.';
	return verb === 'review'
		? 'This dispute is no longer open, so it cannot be moved to under review. Reload to see its current state.'
		: 'This dispute is not under review, so it cannot be resolved. Reload to see its current state.';
}
