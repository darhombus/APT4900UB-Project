<script lang="ts">
	import './layout.css';
	// Fonts installed via Fontsource (not CDN); these register the @font-face
	// families referenced by --font-sans / --font-display in the theme.
	import '@fontsource-variable/inter';
	import '@fontsource-variable/space-grotesk';
	import favicon from '$lib/assets/favicon.svg';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { onMount } from 'svelte';

	let { data, children } = $props();
	let { session, supabase } = $derived(data);
	const profile = $derived(data.profile);

	let accountOpen = $state(false);
	let mobileOpen = $state(false);

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

	/** Close a menu when the user clicks anywhere outside `node`. */
	function clickOutside(node: HTMLElement, onOutside: () => void) {
		function handle(event: MouseEvent) {
			if (!node.contains(event.target as Node)) onOutside();
		}
		document.addEventListener('click', handle, true);
		return {
			destroy() {
				document.removeEventListener('click', handle, true);
			}
		};
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

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			accountOpen = false;
			mobileOpen = false;
		}
	}}
/>

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

			<!-- Account area (desktop) -->
			<div class="hidden items-center gap-3 md:flex">
				{#if session}
					<div class="relative" use:clickOutside={() => (accountOpen = false)}>
						<button
							type="button"
							onclick={() => (accountOpen = !accountOpen)}
							aria-haspopup="menu"
							aria-expanded={accountOpen}
							class="flex items-center gap-2 rounded-pill p-0.5 pr-1 transition-colors hover:bg-page focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
						>
							{@render avatar('h-8 w-8')}
							<svg class="h-4 w-4 text-subtle" viewBox="0 0 20 20" fill="none" aria-hidden="true">
								<path
									d="M6 8l4 4 4-4"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</button>
						{#if accountOpen}
							<div
								role="menu"
								tabindex="-1"
								class="absolute right-0 mt-2 w-52 rounded-card border border-border bg-surface p-1 shadow-menu"
							>
								<a
									role="menuitem"
									href="/account"
									class={menuItem}
									onclick={() => (accountOpen = false)}
								>
									Account
								</a>
								<a
									role="menuitem"
									href="/sell/listings"
									class={menuItem}
									onclick={() => (accountOpen = false)}
								>
									My listings
								</a>
								<div class="my-1 border-t border-border"></div>
								<form
									method="POST"
									action="/logout"
									use:enhance
									onsubmit={() => (accountOpen = false)}
								>
									<button role="menuitem" type="submit" class={`${menuItem} w-full text-left`}>
										Log out
									</button>
								</form>
							</div>
						{/if}
					</div>
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

			<!-- Hamburger (mobile) -->
			<button
				type="button"
				class="inline-flex h-10 w-10 items-center justify-center rounded-control text-ink transition-colors hover:bg-page md:hidden"
				aria-label="Menu"
				aria-expanded={mobileOpen}
				aria-controls="mobile-menu"
				onclick={() => (mobileOpen = !mobileOpen)}
			>
				<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
					{#if mobileOpen}
						<path
							d="M6 6l12 12M18 6L6 18"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
						/>
					{:else}
						<path
							d="M4 7h16M4 12h16M4 17h16"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
						/>
					{/if}
				</svg>
			</button>
		</nav>

		<!-- Mobile menu panel -->
		{#if mobileOpen}
			<div id="mobile-menu" class="border-t border-border bg-surface px-4 py-3 md:hidden">
				<div class="flex flex-col gap-1">
					{#each navLinks as link (link.href)}
						<a href={link.href} class={menuItem} onclick={() => (mobileOpen = false)}
							>{link.label}</a
						>
					{/each}
				</div>
				<div class="my-3 border-t border-border"></div>
				{#if session}
					<div class="flex items-center gap-3 px-1 pb-2">
						{@render avatar('h-9 w-9')}
						<div class="min-w-0">
							<p class="truncate text-sm font-medium text-ink">
								{profile?.full_name ?? 'Your account'}
							</p>
						</div>
					</div>
					<div class="flex flex-col gap-1">
						<a href="/account" class={menuItem} onclick={() => (mobileOpen = false)}>Account</a>
						<a href="/sell/listings" class={menuItem} onclick={() => (mobileOpen = false)}>
							My listings
						</a>
						<form method="POST" action="/logout" use:enhance onsubmit={() => (mobileOpen = false)}>
							<button type="submit" class={`${menuItem} w-full text-left`}>Log out</button>
						</form>
					</div>
				{:else}
					<div class="flex flex-col gap-2">
						<a
							href="/login"
							class="inline-flex h-11 items-center justify-center rounded-control border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-page"
							onclick={() => (mobileOpen = false)}
						>
							Log in
						</a>
						<a
							href="/signup"
							class="inline-flex h-11 items-center justify-center rounded-control bg-brand px-4 text-sm font-medium text-white hover:bg-brand-hover"
							onclick={() => (mobileOpen = false)}
						>
							Sign up
						</a>
					</div>
				{/if}
			</div>
		{/if}
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
</div>
