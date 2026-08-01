import { error, fail, redirect } from '@sveltejs/kit';
import { loadCategoryTree } from '$lib/server/categories';
import { publicUrl } from '$lib/listing-images';
import { findSubcategory } from '$lib/validation/listings';
import { findSpokenConversation, startConversation } from '$lib/server/messaging';
import {
	cancelCheckout,
	findPendingHold,
	startCheckout,
	toCheckoutHold
} from '$lib/server/checkout';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders, locals: { supabase, user } }) => {
	// RLS returns active/sold to anyone, drafts/removed only to their owner (or
	// admin), and NEVER a `deleted` listing (hidden from everyone incl. the owner —
	// so it 404s here). A missing row is a bad id, a stranger's draft, or a deletion.
	const { data: listing } = await supabase
		.from('listings')
		.select(
			'id, seller_id, title, description, price, condition, location_area, status, published_at, created_at, category_id'
		)
		.eq('id', params.id)
		.maybeSingle();

	if (!listing) error(404, 'Listing not found');

	const isOwner = !!user && user.id === listing.seller_id;
	const isPublic = listing.status === 'active' || listing.status === 'sold';
	// The public page is owner-only for non-public statuses (drafts/removed).
	// (RLS also lets admins read them, but this page previews for the owner only.)
	if (!isPublic && !isOwner) error(404, 'Listing not found');

	const [imagesRes, sellerRes, tree] = await Promise.all([
		supabase
			.from('listing_images')
			.select('id, storage_path, position')
			.eq('listing_id', listing.id)
			.order('position', { ascending: true }),
		supabase
			.from('profiles')
			.select('full_name, avatar_url, created_at')
			.eq('id', listing.seller_id)
			.single(),
		loadCategoryTree(supabase)
	]);

	const images = (imagesRes.data ?? []).map((img) => ({
		id: img.id,
		url: publicUrl(supabase, img.storage_path)
	}));

	const match = findSubcategory(tree, listing.category_id);
	const breadcrumb = match
		? {
				top: { name: match.top.name, slug: match.top.slug },
				sub: { name: match.sub.name, slug: match.sub.slug }
			}
		: null;

	// For an authenticated non-owner on an active listing, does a thread already
	// exist? Drives the "Message seller" vs "View conversation" button label.
	const existingConversationId =
		user && !isOwner && listing.status === 'active'
			? await findSpokenConversation(supabase, listing.id, user.id)
			: null;

	// D3 — is a checkout already in progress on this listing? Only meaningful
	// while it's active (Buy Now shows nowhere else), so only looked up there.
	// `toCheckoutHold` strips the holder's identity before it reaches the browser.
	const checkoutHold =
		listing.status === 'active'
			? toCheckoutHold(await findPendingHold(listing.id), user?.id)
			: null;

	// Never let a signed-in buyer's view of a buyable listing be replayed from the
	// browser cache.
	//
	// The Buy Now area is transactional: it renders "Buy now", "Resume payment /
	// Cancel checkout", or a disabled button, depending on a hold that can appear
	// or vanish at any moment. Handing off to Paystack and pressing back re-showed
	// the CACHED page — captured before the order existed — so the buyer saw a
	// dead, still-spinning "Buy now" and no way to cancel the order they had just
	// abandoned. Only a hard reload recovered it.
	//
	// A pageshow/bfcache listener was tried first and does not work: this
	// navigation never fires pageshow, so nothing client-side gets a chance to
	// react. Refusing to store the response is the only reliable fix, and it also
	// clears the stale spinner for free, because the page is rebuilt rather than
	// restored.
	//
	// Scoped deliberately: only for a signed-in non-owner on an ACTIVE listing —
	// exactly the people who can start a checkout. Anonymous and sold/draft views
	// stay cacheable.
	if (user && !isOwner && listing.status === 'active') {
		setHeaders({ 'cache-control': 'no-store' });
	}

	return {
		listing,
		images,
		seller: sellerRes.data,
		breadcrumb,
		isOwner,
		existingConversationId,
		checkoutHold
	};
};

export const actions: Actions = {
	// Start (or resume) a conversation with the seller. Section 6 wires the button
	// that posts here; the guards below back up the conversations_insert RLS policy
	// with friendly, toast-surfaced errors.
	message: async ({ params, url, locals: { supabase, user } }) => {
		if (!user) redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);

		const result = await startConversation(supabase, user.id, params.id);
		if (!result.ok) return fail(400, { formError: result.error });

		redirect(303, `/messages/${result.conversationId}`);
	},

	// Start checkout: take the hold, initialize with Paystack, and hand the buyer
	// off to Paystack's hosted page (D2 — redirect flow, no inline popup, so this
	// works as a plain form POST with no JavaScript).
	buy: async ({ params, url, locals: { supabase, user } }) => {
		if (!user) redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);

		const callbackUrl = new URL('/checkout/callback', url.origin).toString();
		const result = await startCheckout(supabase, user, params.id, callbackUrl);
		if (!result.ok) return fail(400, { formError: result.error });

		redirect(303, result.authorizationUrl);
	},

	// Buyer releases their own hold, re-enabling Buy Now for everyone.
	cancelCheckout: async ({ url, request, locals: { supabase, user } }) => {
		if (!user) redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);

		const orderId = String((await request.formData()).get('orderId') ?? '');
		if (!orderId) return fail(400, { formError: 'Could not cancel that checkout.' });

		const result = await cancelCheckout(supabase, orderId);
		if (!result.ok) return fail(400, { formError: result.error });

		return { success: true, message: 'Checkout cancelled.' };
	}
};
