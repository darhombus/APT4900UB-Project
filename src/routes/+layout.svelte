<script lang="ts">
	import './layout.css';
	// Fonts installed via Fontsource (not CDN); these register the @font-face
	// families referenced by --font-sans / --font-display in the theme.
	import '@fontsource-variable/inter';
	import '@fontsource-variable/space-grotesk';
	import favicon from '$lib/assets/favicon.svg';
	// Import the component directly (not via the $lib/components barrel) so the root
	// layout — loaded on every page — doesn't pull the heavy ListingForm/
	// ImageUploader into its client bundle and slow hydration.
	import SearchBar from '$lib/components/SearchBar.svelte';
	import ToastContainer from '$lib/components/ui/ToastContainer.svelte';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { onMount } from 'svelte';

	let { data, children } = $props();
	let { session, supabase } = $derived(data);
	const profile = $derived(data.profile);

	const year = new Date().getFullYear();

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
	 * The header menus are native <details> disclosures, so they open/close with no
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

	const navLinks = [
		{ href: '/', label: 'Browse' },
		{ href: '/sell', label: 'Sell' }
	];

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
	<header class="sticky top-0 z-40 border-b border-border bg-surface">
		<nav class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
			<!-- Wordmark -->
			<a href="/" class="font-display text-xl font-bold tracking-tight">
				<span class="text-ink">My</span><span class="text-brand">Soko</span>
			</a>

			<!-- Primary nav (desktop) -->
			<div class="hidden items-center gap-1 md:flex">
				{#each navLinks as link (link.href)}
					<a
						href={link.href}
						class="rounded-control px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-page hover:text-ink"
					>
						{link.label}
					</a>
				{/each}
			</div>

			<!-- Search (desktop) -->
			<SearchBar compact class="hidden md:flex md:max-w-xs md:flex-1" />

			<!-- Account area (desktop) -->
			<div class="hidden items-center gap-3 md:flex">
				{#if session}
					<details use:autoClose class="group relative">
						<summary
							aria-label="Account menu"
							class="flex cursor-pointer list-none items-center gap-2 rounded-pill p-0.5 pr-1 transition-colors hover:bg-page focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none [&::-webkit-details-marker]:hidden"
						>
							{@render avatar('h-8 w-8')}
							<svg
								class="h-4 w-4 text-subtle transition-transform group-open:rotate-180"
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
						class="rounded-control px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-page hover:text-ink"
					>
						Log in
					</a>
					<a
						href="/signup"
						class="inline-flex h-11 items-center justify-center rounded-control bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
					>
						Sign up
					</a>
				{/if}
			</div>

			<!-- Mobile menu (native disclosure) -->
			<details use:autoClose class="group md:hidden">
				<summary
					aria-label="Menu"
					class="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-control text-ink transition-colors hover:bg-page [&::-webkit-details-marker]:hidden"
				>
					<svg class="h-6 w-6 group-open:hidden" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path
							d="M4 7h16M4 12h16M4 17h16"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
						/>
					</svg>
					<svg
						class="hidden h-6 w-6 group-open:block"
						viewBox="0 0 24 24"
						fill="none"
						aria-hidden="true"
					>
						<path
							d="M6 6l12 12M18 6L6 18"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
						/>
					</svg>
				</summary>
				<div
					class="absolute inset-x-0 top-full border-t border-border bg-surface px-4 py-3 shadow-menu"
				>
					<SearchBar class="mb-3" />
					<div class="flex flex-col gap-1">
						{#each navLinks as link (link.href)}
							<a href={link.href} class={menuItem} onclick={closeMenu}>{link.label}</a>
						{/each}
					</div>
					<div class="my-3 border-t border-border"></div>
					{#if session}
						<div class="flex items-center gap-3 px-1 pb-2">
							{@render avatar('h-9 w-9')}
							<p class="truncate text-sm font-medium text-ink">
								{profile?.full_name ?? 'Your account'}
							</p>
						</div>
						<div class="flex flex-col gap-1">
							<a href="/account" class={menuItem} onclick={closeMenu}>Account</a>
							<a href="/sell/listings" class={menuItem} onclick={closeMenu}>My listings</a>
							<form method="POST" action="/logout" use:enhance onsubmit={closeMenu}>
								<button type="submit" class={`${menuItem} w-full text-left`}>Log out</button>
							</form>
						</div>
					{:else}
						<div class="flex flex-col gap-2">
							<a
								href="/login"
								class="inline-flex h-11 items-center justify-center rounded-control border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-page"
								onclick={closeMenu}
							>
								Log in
							</a>
							<a
								href="/signup"
								class="inline-flex h-11 items-center justify-center rounded-control bg-brand px-4 text-sm font-medium text-white hover:bg-brand-hover"
								onclick={closeMenu}
							>
								Sign up
							</a>
						</div>
					{/if}
				</div>
			</details>
		</nav>
	</header>

	<div class="flex-1">
		{@render children()}
	</div>

	<footer class="border-t border-border bg-surface">
		<div
			class="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 sm:flex-row sm:items-center sm:justify-between"
		>
			<div>
				<span class="font-display text-lg font-bold tracking-tight">
					<span class="text-ink">My</span><span class="text-brand">Soko</span>
				</span>
				<p class="mt-1 text-sm text-subtle">Kenya's marketplace · Nairobi</p>
			</div>
			<p class="text-sm text-subtle">© {year} My Soko</p>
		</div>
	</footer>

	<!-- App-wide outcome notifications; rendered once here, never per page. -->
	<ToastContainer />
</div>
