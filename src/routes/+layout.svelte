<script lang="ts">
	import './layout.css';
	// Fonts installed via Fontsource (not CDN); these register the @font-face
	// families referenced by --font-sans / --font-display in the theme.
	import '@fontsource-variable/inter';
	import '@fontsource-variable/space-grotesk';
	import favicon from '$lib/assets/favicon.svg';
	// Import components directly (not via the $lib/components barrel) so the root
	// layout — loaded on every page — doesn't pull the heavy ListingForm/
	// ImageUploader into its client bundle and slow hydration.
	import SearchBar from '$lib/components/SearchBar.svelte';
	import CategoryDrawer from '$lib/components/CategoryDrawer.svelte';
	import ToastContainer from '$lib/components/ui/ToastContainer.svelte';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { unreadCount as unreadCountStore } from '$lib/unread-count.svelte';
	import { notificationCount as notificationCountStore } from '$lib/notification-count.svelte';

	let { data, children } = $props();
	let { session, supabase } = $derived(data);
	const profile = $derived(data.profile);
	// ADM-28: seller-only since ADM-25 closed /sell to admins. Display signal for
	// the seller nav entries; it gates no route.
	const isSeller = $derived(data.isSeller);
	// BST-20. Definitionally identical to `isSeller` after ADM-28, and kept
	// separate on purpose: this gates the "New listing" button, isSeller gates
	// the nav entries, and the two can diverge again.
	const canCreateListing = $derived(data.canCreateListing);
	// ADM-14 + ADM-26. Which navigation an admin is SHOWN, and which participant
	// affordances they are NOT — an admin is staff, not a marketplace
	// participant. Routes are gated elsewhere: /admin by requireRole(...,
	// { hide: true }), /sell by its own layout guard (ADM-25).
	const isAdmin = $derived(data.isAdmin);
	// ADM-26 — the participant affordances an admin does not get: Buy now,
	// Message seller, Orders, Messages, the notification bell, and both Realtime
	// subscriptions. Named once and shared so the header's avatar badge and its
	// Messages menu entry cannot drift apart: the badge is aria-hidden and takes
	// its accessible name from that entry's aria-label, so hiding either alone
	// leaves a visible count with no accessible name pointing at a destination
	// that no longer exists.
	const isParticipant = $derived(!isAdmin);
	const categoryTree = $derived(data.categoryTree);

	// Unread-conversation badge (D5). Seeded from the server-computed layout value
	// (so SSR and hydration match), then kept live by the subscription below via a
	// direct store update — NOT via invalidate('app:unread'), which used to force
	// the whole root layout (profile + category tree + auth revalidation) to
	// reload on every incoming message and made the app feel like it hung during
	// an active conversation. Capped at 9+ for display.
	$effect(() => {
		unreadCountStore.set(data.unreadCount ?? 0);
	});
	const unreadCount = $derived(unreadCountStore.value);
	const unreadLabel = $derived(unreadCount > 9 ? '9+' : String(unreadCount));

	// Unread-NOTIFICATION badge (NTF-10, NTF-18), seeded and kept live by exactly
	// the same mechanism as the conversation badge above — separate store,
	// separate channel, separate endpoint. Capped at 9+ identically.
	$effect(() => {
		notificationCountStore.set(data.notificationCount ?? 0);
	});
	const notificationCount = $derived(notificationCountStore.value);
	const notificationLabel = $derived(notificationCount > 9 ? '9+' : String(notificationCount));

	// Stable identity + token (both strings) so the live-badge subscription below
	// re-subscribes only on login/logout/token-refresh — not on every invalidate.
	const userId = $derived(data.user?.id ?? null);
	const accessToken = $derived(session?.access_token ?? null);

	// The focused auth pages render without the top bar + drawer.
	const AUTH_PATHS = ['/login', '/signup', '/forgot-password', '/reset-password'];
	const bareAuth = $derived(AUTH_PATHS.includes(page.url.pathname));

	const year = new Date().getFullYear();

	// ── Slide-out category sidebar ──────────────────────────────────────────────
	let sidebarOpen = $state(false);
	let hamburgerEl = $state<HTMLButtonElement | null>(null);
	function openSidebar() {
		sidebarOpen = true;
	}
	// Closing returns focus to the hamburger (the drawer's trigger).
	function closeSidebar() {
		sidebarOpen = false;
		hamburgerEl?.focus();
	}

	function initials(name: string | null | undefined): string {
		if (!name) return '?';
		return name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0]!.toUpperCase())
			.join('');
	}

	/**
	 * The account menu is a native <details> disclosure, so it opens/closes with no
	 * JavaScript — important on low-end Android and immune to hydration timing. This
	 * action is pure progressive enhancement: when JS is available it closes an open
	 * menu on an outside click or Escape.
	 */
	function autoClose(node: HTMLDetailsElement) {
		function onDocClick(event: MouseEvent) {
			if (node.open && !node.contains(event.target as Node)) node.open = false;
		}
		function onKey(event: KeyboardEvent) {
			if (event.key === 'Escape') node.open = false;
		}
		document.addEventListener('click', onDocClick, true);
		document.addEventListener('keydown', onKey);
		return {
			destroy() {
				document.removeEventListener('click', onDocClick, true);
				document.removeEventListener('keydown', onKey);
			}
		};
	}

	/** Close the enclosing menu after a link click / form submit (SPA nav keeps it open). */
	function closeMenu(event: Event) {
		(event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
	}

	/**
	 * Scroll to the very top. A plain `#top` anchor doesn't work here: it targets the
	 * sticky header, which is already pinned in view, so the browser scrolls nowhere.
	 *
	 * The animation is driven by requestAnimationFrame rather than the native
	 * `scrollTo({ behavior: 'smooth' })`. Native smooth scroll is intermittently
	 * dropped in desktop Chrome/Edge — a second smooth scroll to the same target, or
	 * one issued while wheel momentum is still settling, is silently cancelled, which
	 * showed up as "click works, next click does nothing, the one after works". Setting
	 * the position ourselves each frame can't be deduped or pre-empted by that
	 * scheduler, so every click lands. Reduced motion → jump instantly.
	 */
	let scrollAnim: number | null = null;
	function scrollToTop() {
		if (scrollAnim !== null) cancelAnimationFrame(scrollAnim);
		const start = window.scrollY;
		if (start <= 0) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			window.scrollTo(0, 0);
			scrollAnim = null;
			return;
		}
		const startTime = performance.now();
		const duration = Math.min(600, Math.max(250, start * 0.6));
		const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
		const step = (now: number) => {
			const t = Math.min(1, (now - startTime) / duration);
			window.scrollTo(0, Math.round(start * (1 - easeOutCubic(t))));
			scrollAnim = t < 1 ? requestAnimationFrame(step) : null;
		};
		scrollAnim = requestAnimationFrame(step);
	}

	// The floating back-to-top button appears once the user has scrolled down. The
	// trigger is adaptive — ~40% of the scrollable distance, capped at 300px — so it
	// also shows on tall desktop monitors where the short 4-col grid scrolls little,
	// while staying hidden on pages that barely scroll at all.
	let scrolled = $state(false);
	$effect(() => {
		const onScroll = () => {
			const max = document.documentElement.scrollHeight - window.innerHeight;
			scrolled = max > 40 && window.scrollY > Math.min(300, max * 0.4);
		};
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll, { passive: true });
		return () => {
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
		};
	});

	const menuItem =
		'block rounded-control px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-page hover:text-ink';

	// ── Live unread badge ────────────────────────────────────────────────────────
	// App-wide subscription so the header count updates without a refresh: it goes UP
	// when a message arrives in any of the user's conversations while they're on
	// another page, and the thread view drives it DOWN on read. RLS scopes the stream
	// to the user's own conversations (the messages SELECT policy is evaluated per
	// subscriber), so an unfiltered INSERT subscription only ever delivers messages
	// they may see. Recompute is coalesced so a burst can't thrash the count endpoint.
	//
	// ADM-26 — NOT OPENED FOR AN ADMIN. This reverses an earlier draft that kept
	// this subscription while removing only its notifications twin. Every render
	// consumer of the messages store is now hidden for an admin (the avatar
	// badge, the Messages menu entry, the drawer entry), so for that role the
	// store is write-only and this channel would poll /api/unread-count on every
	// incoming message to update nothing. The thread page at
	// messages/[conversationId] is unaffected: it WRITES the store after its own
	// fetch and never depended on this subscription.
	$effect(() => {
		const uid = userId;
		const token = accessToken;
		if (!uid || !supabase || !isParticipant) return;
		const client = supabase;
		void client.realtime.setAuth(token);

		let pending: ReturnType<typeof setTimeout> | null = null;
		const refresh = () => {
			if (pending) return;
			pending = setTimeout(() => {
				pending = null;
				fetch('/api/unread-count')
					.then((r) => r.json())
					.then(({ count }) => unreadCountStore.set(count))
					.catch(() => {});
			}, 250);
		};

		const channel = client
			.channel('user-unread')
			.on(
				'postgres_changes',
				{ event: 'INSERT', schema: 'public', table: 'messages' },
				(payload) => {
					// Only a message from the counterpart changes the user's unread state.
					if ((payload.new as { sender_id?: string }).sender_id !== uid) refresh();
				}
			)
			.subscribe();

		return () => {
			if (pending) clearTimeout(pending);
			client.removeChannel(channel);
		};
	});

	// ── Live notification badge (NTF-10) ────────────────────────────────────────
	// The bell's twin of the subscription above. RLS scopes the stream: Realtime
	// evaluates notifications_select per subscriber against their JWT, so an
	// unfiltered INSERT subscription delivers only the user's own rows — there is
	// no sender to compare against here, because every row that arrives is by
	// definition for this user. Coalesced for the same reason: a burst of events
	// (an order completing notifies both parties) must not thrash the endpoint.
	//
	// ADM-26 — NOT OPENED FOR AN ADMIN. No notification type resolves to an admin
	// recipient (every recipient is read off the order, payout, review, boost or
	// dispute record, never off role), and ADM-26 removes the bell that would
	// display the count, so this channel can only ever cost. /notifications stays
	// reachable under ADM-29, and the page reads its own count server-side — it
	// does not depend on this subscription.
	$effect(() => {
		const uid = userId;
		const token = accessToken;
		if (!uid || !supabase || !isParticipant) return;
		const client = supabase;
		void client.realtime.setAuth(token);

		let pending: ReturnType<typeof setTimeout> | null = null;
		// MONOTONIC REQUEST TOKEN. `pending` is cleared when the timer fires, not
		// when the fetch settles, so two counts can be in flight at once — and if
		// the older one resolves last, it overwrites the newer with a stale, LOWER
		// number and the badge stays wrong until the next navigation. Ignoring any
		// response that is not the newest issued makes the last request win
		// regardless of the order the network returns them in.
		//
		// Clearing `pending` on settle instead would fix the overlap by preventing
		// it, but at a worse cost: an event arriving during a slow fetch would find
		// `pending` still set and be dropped entirely, and that fetch may have been
		// issued before the row was committed.
		//
		// This is the evidenced mechanism behind an UNREPRODUCED failure (0/19 in
		// the 2026-08-11 diagnostic run) — see the local project notes, which
		// records it honestly as a fix to a hypothesis rather than to a
		// demonstrated fault.
		let latest = 0;
		const refresh = () => {
			if (pending) return;
			pending = setTimeout(() => {
				pending = null;
				const seq = ++latest;
				fetch('/api/notification-count')
					.then((r) => r.json())
					.then(({ count }) => {
						if (seq === latest) notificationCountStore.set(count);
					})
					.catch(() => {});
			}, 250);
		};

		const channel = client
			.channel('user-notifications')
			.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () =>
				refresh()
			)
			// Refresh once the channel is actually joined, which closes the gap
			// between this page rendering its SSR count and the subscription being
			// live: anything inserted during the join is never delivered to us, and
			// without this the badge would stay stale until the next navigation.
			// A deliberate (small) improvement on the messages twin, which has the
			// same gap — it also makes the e2e spec deterministic instead of racing
			// the join.
			.subscribe((status) => {
				if (status === 'SUBSCRIBED') refresh();
			});

		return () => {
			if (pending) clearTimeout(pending);
			client.removeChannel(channel);
		};
	});

	/**
	 * Keep server load functions in sync with client-side auth changes. When the
	 * user logs in or out (here or in another tab), Supabase fires onAuthStateChange;
	 * if the session actually changed we invalidate 'supabase:auth', which reruns
	 * every load that declared depends('supabase:auth') — so the UI updates without
	 * a manual refresh.
	 */
	onMount(() => {
		// Hydration sentinel. onMount runs only after the client has SUCCESSFULLY
		// hydrated this page, so e2e tests can wait for html[data-hydrated] to prove
		// handlers are wired. If hydration bails, this never sets it and the waiting
		// test times out — turning a silent, invisible failure into a loud one.
		document.documentElement.dataset.hydrated = 'true';

		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((_, newSession) => {
			if (newSession?.expires_at !== session?.expires_at) {
				invalidate('supabase:auth');
			}
		});

		return () => subscription.unsubscribe();
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#snippet avatar(size: string)}
	{#if profile?.avatar_url}
		<img src={profile.avatar_url} alt="" class={`${size} rounded-pill object-cover`} />
	{:else}
		<span
			class={`${size} flex items-center justify-center rounded-pill bg-brand-tint text-xs font-semibold text-brand-strong`}
		>
			{initials(profile?.full_name)}
		</span>
	{/if}
{/snippet}

<!-- Auth pages are pinned to the viewport (header + footer always visible, form
     centered between them); every other page grows and scrolls normally. -->
<div class={`flex flex-col ${bareAuth ? 'h-dvh' : 'min-h-screen'}`}>
	{#if bareAuth}
		<!-- Minimal auth header: the top-bar band + wordmark, without search/nav. -->
		<header class="bg-brand-strong text-white">
			<div class="mx-auto flex max-w-6xl items-center justify-center px-4 py-2">
				<a href="/" class="font-display text-lg font-bold tracking-tight text-white sm:text-xl">
					My<span class="text-white/75">Soko</span>
				</a>
			</div>
		</header>
	{:else}
		<header class="sticky top-0 z-40 bg-brand-strong text-white">
			<div class="mx-auto max-w-6xl px-4">
				<!-- Row 1: menu + logo, (search on desktop), account/auth -->
				<div class="flex items-center gap-2 py-2.5 sm:gap-3">
					<button
						bind:this={hamburgerEl}
						type="button"
						onclick={openSidebar}
						aria-label="Open menu"
						aria-expanded={sidebarOpen}
						aria-controls="category-drawer"
						class="flex h-10 flex-none items-center gap-1.5 rounded-control px-2 text-sm font-medium transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
					>
						<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
							<path
								d="M4 7h16M4 12h16M4 17h16"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
							/>
						</svg>
						<span class="hidden sm:inline">All</span>
					</button>

					<a
						href="/"
						class="flex-none font-display text-lg font-bold tracking-tight text-white sm:text-xl"
					>
						My<span class="text-white/75">Soko</span>
					</a>

					<!-- Desktop: search is the dominant central instrument -->
					<div class="hidden flex-1 md:block">
						<!-- Distinct idPrefix per instance: both bars exist in the DOM at once
						     (each is hidden at the other's breakpoint), so shared field ids
						     would be duplicates and `<label for>` would target the wrong one. -->
						<SearchBar {categoryTree} idPrefix="sb-desktop" />
					</div>

					<!-- Mobile: spacer pushes the account cluster to the right -->
					<div class="flex-1 md:hidden"></div>

					<div class="flex flex-none items-center gap-1">
						{#if session}
							{#if canCreateListing}
								<a
									href="/sell/listings/new"
									class="hidden h-10 items-center gap-1.5 rounded-control bg-white px-3 text-sm font-semibold text-brand-strong transition-colors hover:bg-white/90 sm:inline-flex"
								>
									<svg class="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
										<path
											d="M10 4v12M4 10h12"
											stroke="currentColor"
											stroke-width="1.8"
											stroke-linecap="round"
										/>
									</svg>
									New listing
								</a>
							{/if}
							<!-- The bell sits BESIDE the account menu, not inside it (NTF-18):
							     two distinct icons, so a glance tells the two counts apart.
							     Notifications are a place you go, not a menu you open, so it is
							     a plain link to the inbox rather than a dropdown.

							     ADM-26: not offered to an admin. No notification type resolves
							     to an admin recipient, so for that role this was permanently
							     dead UI. /notifications itself stays reachable (ADM-29). -->
							{#if isParticipant}
								<a
									href="/notifications"
									data-testid="header-bell"
									aria-label={notificationCount > 0
										? `Notifications, ${notificationLabel} unread`
										: 'Notifications'}
									class="relative flex h-10 w-10 items-center justify-center rounded-control transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
								>
									<svg
										class="h-5 w-5 text-white"
										viewBox="0 0 20 20"
										fill="none"
										aria-hidden="true"
									>
										<path
											d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 2.6-.6 4.1-1.1 4.9a.6.6 0 0 0 .5.9h10.2a.6.6 0 0 0 .5-.9c-.5-.8-1.1-2.3-1.1-4.9A4.5 4.5 0 0 0 10 3Z"
											stroke="currentColor"
											stroke-width="1.6"
											stroke-linejoin="round"
										/>
										<path
											d="M8.3 16a1.8 1.8 0 0 0 3.4 0"
											stroke="currentColor"
											stroke-width="1.6"
											stroke-linecap="round"
										/>
									</svg>
									{#if notificationCount > 0}
										<!-- Glanceable count; the link's aria-label carries it for AT. -->
										<span
											data-testid="header-notification-badge"
											aria-hidden="true"
											class="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-pill bg-accent px-1 text-[10px] font-bold text-white ring-2 ring-brand-strong"
										>
											{notificationLabel}
										</span>
									{/if}
								</a>
							{/if}
							<details use:autoClose class="group relative">
								<summary
									aria-label="Account menu"
									class="flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-control px-1.5 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none [&::-webkit-details-marker]:hidden"
								>
									<span class="relative flex-none">
										{@render avatar('h-8 w-8')}
										<!-- ADM-26: `isParticipant` here is PAIRED with the Messages menu
										     entry below and must not be separated from it. This badge is
										     aria-hidden and has no accessible name of its own — the
										     Messages entry's aria-label is its only one. Hiding one
										     without the other leaves a visible count that screen readers
										     cannot name, pointing at a destination that is gone. -->
										{#if isParticipant && unreadCount > 0}
											<!-- Glanceable unread count; the Messages menu item carries the accessible label. -->
											<span
												data-testid="header-unread-badge"
												aria-hidden="true"
												class="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-pill bg-accent px-1 text-[10px] font-bold text-white ring-2 ring-brand-strong"
											>
												{unreadLabel}
											</span>
										{/if}
									</span>
									<svg
										class="h-4 w-4 text-white/80 transition-transform group-open:rotate-180"
										viewBox="0 0 20 20"
										fill="none"
										aria-hidden="true"
									>
										<path
											d="M6 8l4 4 4-4"
											stroke="currentColor"
											stroke-width="1.5"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
								</summary>
								<div
									class="absolute right-0 mt-2 w-52 rounded-card border border-border bg-surface p-1 shadow-menu"
								>
									<!-- ADM-26: Messages is a participant capability. PAIRED with the
									     avatar badge above — this entry's aria-label is that badge's
									     only accessible name, so the two are gated together. -->
									{#if isParticipant}
										<a
											href="/messages"
											class={`${menuItem} flex items-center justify-between`}
											onclick={closeMenu}
											aria-label={unreadCount > 0 ? `Messages, ${unreadLabel} unread` : 'Messages'}
										>
											<span>Messages</span>
											{#if unreadCount > 0}
												<span
													aria-hidden="true"
													class="flex h-5 min-w-5 items-center justify-center rounded-pill bg-accent px-1.5 text-xs font-bold text-white"
												>
													{unreadLabel}
												</span>
											{/if}
										</a>
									{/if}
									<!-- ADM-27: /account is retained in full for every role. -->
									<a href="/account" class={menuItem} onclick={closeMenu}>Account</a>
									<!-- ADM-26: an admin holds no orders and cannot open one (ADM-18).
									     The ROUTE stays reachable (ADM-29) so a legacy in-flight order
									     can still be discharged; only the nav entry goes. -->
									{#if isParticipant}
										<a href="/account/orders" class={menuItem} onclick={closeMenu}>Orders</a>
									{/if}
									{#if isAdmin}
										<!-- ADM-14: admin navigation INSTEAD OF seller navigation. An
										     admin does not sell, so My listings / Sales / Payouts are
										     three dead ends for them. Their /sell/* access is untouched
										     (ADM-2) — they are simply not pointed at it. The absence of
										     this entry is what prompted the ruling. -->
										<a href="/admin" class={menuItem} onclick={closeMenu}>Admin dashboard</a>
									{:else if isSeller}
										<a href="/sell/listings" class={menuItem} onclick={closeMenu}>My listings</a>
										<!-- Sellers only: /sell/sales would bounce a buyer to onboarding,
										     so don't offer it to them at all. No counter — that's
										     notification-phase territory (D11). -->
										<a href="/sell/sales" class={menuItem} onclick={closeMenu}>Sales</a>
										<a href="/sell/payouts" class={menuItem} onclick={closeMenu}>Payouts</a>
									{/if}
									<div class="my-1 border-t border-border"></div>
									<form method="POST" action="/logout" use:enhance onsubmit={closeMenu}>
										<button type="submit" class={`${menuItem} w-full text-left`}>Log out</button>
									</form>
								</div>
							</details>
						{:else}
							<!-- Logged out: one account icon menu (mirrors the logged-in one) → Log in / Sign up. -->
							<details use:autoClose class="group relative">
								<summary
									aria-label="Log in or sign up"
									class="flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-control px-2 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none [&::-webkit-details-marker]:hidden"
								>
									<svg
										class="h-5 w-5 text-white"
										viewBox="0 0 20 20"
										fill="none"
										aria-hidden="true"
									>
										<circle cx="10" cy="7" r="3" stroke="currentColor" stroke-width="1.6" />
										<path
											d="M4.5 16.5a5.5 5.5 0 0 1 11 0"
											stroke="currentColor"
											stroke-width="1.6"
											stroke-linecap="round"
										/>
									</svg>
									<svg
										class="h-4 w-4 text-white/80 transition-transform group-open:rotate-180"
										viewBox="0 0 20 20"
										fill="none"
										aria-hidden="true"
									>
										<path
											d="M6 8l4 4 4-4"
											stroke="currentColor"
											stroke-width="1.5"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
								</summary>
								<div
									class="absolute right-0 mt-2 w-44 rounded-card border border-border bg-surface p-1 shadow-menu"
								>
									<a href="/login" class={menuItem} onclick={closeMenu}>Log in</a>
									<a href="/signup" class={menuItem} onclick={closeMenu}>Sign up</a>
								</div>
							</details>
						{/if}
					</div>
				</div>

				<!-- Row 2 (mobile only): search on its own full-width line, always visible -->
				<div class="pb-2.5 md:hidden">
					<SearchBar {categoryTree} idPrefix="sb-mobile" />
				</div>
			</div>
		</header>

		<CategoryDrawer
			open={sidebarOpen}
			onclose={closeSidebar}
			{categoryTree}
			loggedIn={!!session}
			{isSeller}
			{isAdmin}
			{profile}
			{unreadCount}
			{notificationCount}
		/>
	{/if}

	<div class={`flex-1 ${bareAuth ? 'flex min-h-0 flex-col overflow-y-auto' : ''}`}>
		{@render children()}
	</div>

	<footer class="border-t border-border bg-surface">
		<div
			class="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-5 text-sm text-subtle sm:flex-row sm:items-center sm:justify-between"
		>
			<p>
				<span class="font-display font-bold tracking-tight text-ink"
					>My<span class="text-brand">Soko</span></span
				>
				<span class="ml-1.5">Kenya's marketplace</span>
			</p>
			<p>© {year} My Soko</p>
		</div>
	</footer>

	<!-- Floating back-to-top: a circular up-to-top icon, shown once scrolled down. It
	     is ALWAYS mounted and only toggles visibility via classes (opacity + pointer
	     events); mounting/unmounting it under a smooth scroll made repeated clicks land
	     on an element mid-transition, so they intermittently did nothing. -->
	<button
		type="button"
		onclick={scrollToTop}
		aria-label="Back to top"
		aria-hidden={!scrolled}
		tabindex={scrolled ? 0 : -1}
		class={`fixed right-5 bottom-5 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-brand text-white shadow-menu transition duration-200 hover:bg-brand-hover focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none sm:bottom-2 ${scrolled ? 'opacity-100' : 'pointer-events-none translate-y-2 opacity-0'}`}
	>
		<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<path d="M6 5h12" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
			<path d="M12 20V9" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
			<path
				d="M7 14l5-5 5 5"
				stroke="currentColor"
				stroke-width="1.9"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	</button>

	<!-- App-wide outcome notifications; rendered once here, never per page. -->
	<ToastContainer />
</div>
