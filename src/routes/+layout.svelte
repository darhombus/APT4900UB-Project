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

	let { data, children } = $props();
	let { session, supabase } = $derived(data);
	const profile = $derived(data.profile);
	const isSeller = $derived(data.isSeller);
	const categoryTree = $derived(data.categoryTree);

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
	 * Scrolling the window directly is reliable. Reduced motion → instant, not smooth.
	 */
	function scrollToTop() {
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
	}

	// The floating back-to-top button appears only once the user has scrolled down.
	let scrolled = $state(false);
	$effect(() => {
		const onScroll = () => (scrolled = window.scrollY > 300);
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	});

	const menuItem =
		'block rounded-control px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-page hover:text-ink';

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

<div class="flex min-h-screen flex-col">
	{#if bareAuth}
		<!-- Minimal auth header: just the wordmark, a link back to the homepage. -->
		<header class="border-b border-border bg-surface">
			<div class="mx-auto max-w-6xl px-4 py-4">
				<a href="/" class="font-display text-xl font-bold tracking-tight">
					<span class="text-ink">My</span><span class="text-brand">Soko</span>
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
						<SearchBar />
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
									{@render avatar('h-8 w-8')}
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
									<a href="/account" class={menuItem} onclick={closeMenu}>Account</a>
									<a href="/sell/listings" class={menuItem} onclick={closeMenu}>My listings</a>
									<div class="my-1 border-t border-border"></div>
									<form method="POST" action="/logout" use:enhance onsubmit={closeMenu}>
										<button type="submit" class={`${menuItem} w-full text-left`}>Log out</button>
									</form>
								</div>
							</details>
						{:else}
							<a
								href="/login"
								class="inline-flex h-10 items-center gap-1.5 rounded-control px-2.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
							>
								<svg class="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
									<circle cx="10" cy="7" r="3" stroke="currentColor" stroke-width="1.6" />
									<path
										d="M4.5 16.5a5.5 5.5 0 0 1 11 0"
										stroke="currentColor"
										stroke-width="1.6"
										stroke-linecap="round"
									/>
								</svg>
								Log in
							</a>
							<a
								href="/signup"
								class="inline-flex h-10 flex-none items-center rounded-control bg-white px-3 text-sm font-semibold text-brand-strong transition-colors hover:bg-white/90"
							>
								Sign up
							</a>
						{/if}
					</div>
				</div>

				<!-- Row 2 (mobile only): search on its own full-width line, always visible -->
				<div class="pb-2.5 md:hidden">
					<SearchBar />
				</div>
			</div>
		</header>

		<CategoryDrawer
			open={sidebarOpen}
			onclose={closeSidebar}
			{categoryTree}
			loggedIn={!!session}
			{profile}
		/>
	{/if}

	<div class={`flex-1 ${bareAuth ? 'flex flex-col justify-center' : ''}`}>
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
				<span class="ml-1.5">Kenya's marketplace · Nairobi</span>
			</p>
			<p>© {year} My Soko</p>
		</div>
	</footer>

	<!-- Floating back-to-top: a circular up-to-top icon, shown once scrolled down. -->
	{#if scrolled}
		<button
			type="button"
			onclick={scrollToTop}
			aria-label="Back to top"
			class="fixed right-5 bottom-5 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-brand text-white shadow-menu transition-colors hover:bg-brand-hover focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none"
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
	{/if}

	<!-- App-wide outcome notifications; rendered once here, never per page. -->
	<ToastContainer />
</div>
