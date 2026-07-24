import { loadCategoryTree } from '$lib/server/categories';
import { unreadConversationCount } from '$lib/server/messaging';
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
	let unreadCount = 0;
	if (session && user) {
		// Header essentials + the unread-conversation count for the badge, in parallel.
		// Computed server-side like the rest of the session-dependent UI, so SSR and
		// hydration agree (no mismatch). The badge refreshes on navigation, not live.
		//
		// The unread count is best-effort: it rides in the same Promise.all as the
		// profile fetch, so a throw here would otherwise reject the whole layout load
		// and take down every page. Catch it to 0 — a non-critical badge must never be
		// able to crash the shell (worst case the badge is briefly absent).
		const [{ data }, unread] = await Promise.all([
			supabase.from('profiles').select('full_name, avatar_url, role').eq('id', user.id).single(),
			unreadConversationCount(supabase, user.id).catch(() => 0)
		]);
		if (data) {
			profile = { full_name: data.full_name, avatar_url: data.avatar_url };
			isSeller = data.role === 'seller' || data.role === 'admin';
			// Prime the request-scoped role cache so the /sell guard reuses this fetch
			// instead of issuing its own profile query.
			locals.roleCache = Promise.resolve(data.role);
		}
		unreadCount = unread;
	}

	return {
		session,
		// Forward the server-validated user (from safeGetSession -> getUser in
		// hooks.server.ts) so the client can render the initial auth state without
		// re-fetching it and racing the cookie. safeGetSession itself is unchanged.
		user,
		profile,
		isSeller,
		unreadCount,
		categoryTree: await categoriesPromise,
		cookies: cookies.getAll()
	};
};
