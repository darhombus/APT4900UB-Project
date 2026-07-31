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

	let { data, children } = $props();
	let { session, supabase } = $derived(data);
	const profile = $derived(data.profile);
	const isSeller = $derived(data.isSeller);
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
	$effect(() => {
		const uid = userId;
		const token = accessToken;
		if (!uid || !supabase) return;
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
						<SearchBar {categoryTree} />
					</div>

					<!-- Mobile: spacer pushes the account cluster to the right -->
					<div class="flex-1 md:hidden"></div>

					<div class="flex flex-none items-center gap-1">
						{#if session}
							{#if isSeller}
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
							<details use:autoClose class="group relative">
								<summary
									aria-label="Account menu"
									class="flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-control px-1.5 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none [&::-webkit-details-marker]:hidden"
								>
									<span class="relative flex-none">
										{@render avatar('h-8 w-8')}
										{#if unreadCount > 0}
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
									<a href="/account" class={menuItem} onclick={closeMenu}>Account</a>
									<a href="/account/orders" class={menuItem} onclick={closeMenu}>Orders</a>
									<!-- Link buyers straight to onboarding: /sell/listings would just
									     server-redirect them there (an extra round-trip). -->
									<a
										href={isSeller ? '/sell/listings' : '/sell/onboarding'}
										class={menuItem}
										onclick={closeMenu}>My listings</a
									>
									{#if isSeller}
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
					<SearchBar {categoryTree} />
				</div>
			</div>
		</header>

		<CategoryDrawer
			open={sidebarOpen}
			onclose={closeSidebar}
			{categoryTree}
			loggedIn={!!session}
			{isSeller}
			{profile}
			{unreadCount}
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
