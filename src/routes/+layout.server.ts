import { loadCategoryTree } from '$lib/server/categories';
import { unreadConversationCount } from '$lib/server/messaging';
import { unreadNotificationCount } from '$lib/server/notifications';
import type { LayoutServerLoad } from './$types';

/**
 * Runs on the server for every route. `locals.session` is already the validated
 * session (the `auth` handle resolved it via getUser once for this request), so we
 * pass it straight down and forward cookies that +layout.ts uses to seed the
 * browser/server clients. For signed-in users we also fetch the header essentials
 * (avatar + name) and the role (to gate the "New listing" action). The category
 * tree feeds the slide-out sidebar rendered on every page.
 */
export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	const { session, user, supabase } = locals;

	// unreadCount below is only the SSR seed. Live updates go through the
	// dedicated /api/unread-count endpoint + the client-side unread-count store
	// (see +layout.svelte), not a layout reload — invalidating this whole load
	// per message used to re-run the profile + category-tree queries too and
	// made the app feel like it hung during an active conversation.

	// Kick off the category query immediately so it overlaps the profile fetch.
	const categoriesPromise = loadCategoryTree(supabase);

	let profile: { full_name: string; avatar_url: string | null } | null = null;
	let isSeller = false;
	let canCreateListing = false;
	let isAdmin = false;
	let unreadCount = 0;
	let notificationCount = 0;
	if (session && user) {
		// Header essentials + the unread-conversation count for the badge, in parallel.
		// Computed server-side like the rest of the session-dependent UI, so SSR and
		// hydration agree (no mismatch). The badge refreshes on navigation, not live.
		//
		// The unread count is best-effort: it rides in the same Promise.all as the
		// profile fetch, so a throw here would otherwise reject the whole layout load
		// and take down every page. Catch it to 0 — a non-critical badge must never be
		// able to crash the shell (worst case the badge is briefly absent).
		const [{ data }, unread, notifications] = await Promise.all([
			supabase.from('profiles').select('full_name, avatar_url, role').eq('id', user.id).single(),
			unreadConversationCount(supabase, user.id).catch(() => 0),
			// Same best-effort contract as the conversation count above, and for the
			// same reason: a bell badge must never be able to take down the shell.
			unreadNotificationCount(supabase).catch(() => 0)
		]);
		if (data) {
			profile = { full_name: data.full_name, avatar_url: data.avatar_url };
			// ADM-28: seller-only. This previously read `seller || admin`, which
			// dated from ADM-2 admitting admins to /sell. ADM-25 withdrew that, so
			// the disjunction now describes nothing true: an admin is not a seller
			// and is no longer pointed at, or admitted to, any seller surface.
			// Note this signal does not GATE /sell entry and never did — the route
			// guard at (protected)/sell/+layout.server.ts does, and it redirects an
			// admin to /admin before its own seller check. This is display only.
			isSeller = data.role === 'seller';
			// BST-19/BST-20: listing creation is a seller capability only, so the
			// create affordance needs its own signal, separate from the nav one.
			//
			// AFTER ADM-28 THIS IS DEFINITIONALLY IDENTICAL TO `isSeller` ABOVE, and
			// the two are deliberately NOT collapsed. They gate different things —
			// isSeller gates nav entries (My listings / Sales / Payouts),
			// canCreateListing gates the "New listing" button — and they could
			// diverge again the moment either capability moves. BST-20's reason for
			// minting a third signal rather than redefining a shared one holds
			// exactly as written; collapsing them now would have to be undone by the
			// next ruling that separates them.
			canCreateListing = data.role === 'seller';
			// ADM-14, the same precedent again: a THIRD display signal rather than a
			// redefinition of either existing one. This governs which navigation an
			// admin is SHOWN, and since ADM-26 it also governs which participant
			// affordances they are NOT shown (Buy now, Message seller, Orders,
			// Messages, the bell) and whether the two Realtime subscriptions are
			// opened at all. Nothing here gates a ROUTE — /admin is guarded by
			// requireRole(..., { hide: true }) and /sell by its own layout guard;
			// both are unaffected by this flag.
			isAdmin = data.role === 'admin';
			// Prime the request-scoped role cache so the /sell guard reuses this fetch
			// instead of issuing its own profile query.
			locals.roleCache = Promise.resolve(data.role);
		}
		unreadCount = unread;
		notificationCount = notifications;
	}

	return {
		session,
		// Forward the server-validated user (from safeGetSession -> getClaims in
		// hooks.server.ts) so the client can render the initial auth state without
		// re-fetching it and racing the cookie.
		user,
		profile,
		isSeller,
		canCreateListing,
		isAdmin,
		unreadCount,
		notificationCount,
		categoryTree: await categoriesPromise,
		cookies: cookies.getAll()
	};
};
