<script lang="ts">
	import { enhance } from '$app/forms';
	import { browser } from '$app/environment';
	import { fly, fade } from 'svelte/transition';
	import type { CategoryTree } from '$lib/validation/listings';

	interface Props {
		open: boolean;
		/** Close the drawer (and return focus to the trigger, handled by the caller). */
		onclose: () => void;
		categoryTree: CategoryTree[];
		loggedIn: boolean;
		profile: { full_name: string; avatar_url: string | null } | null;
	}

	let { open, onclose, categoryTree, loggedIn, profile }: Props = $props();

	let panelEl = $state<HTMLDivElement | null>(null);
	let closeButtonEl = $state<HTMLButtonElement | null>(null);

	// Respect reduced motion: skip the slide/fade if the user asked for less motion.
	const duration = browser && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 200 : 0;

	// While open: lock body scroll and move focus into the drawer. Cleanup restores
	// scroll when it closes or the component unmounts.
	$effect(() => {
		if (!open) return;
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		closeButtonEl?.focus();
		return () => {
			document.body.style.overflow = previous;
		};
	});

	// Escape closes; Tab is trapped so focus can't leave the open drawer.
	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
			return;
		}
		if (event.key !== 'Tab' || !panelEl) return;
		const focusables = [
			...panelEl.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
			)
		].filter((el) => el.offsetParent !== null);
		if (focusables.length === 0) return;
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
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

	const sectionLabel = 'px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-subtle uppercase';
	const navItem =
		'flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-page focus-visible:bg-page focus-visible:outline-none';
</script>

{#if open}
	<!-- eslint-disable-next-line svelte/no-static-element-interactions -->
	<div
		id="category-drawer"
		class="fixed inset-0 z-50"
		role="dialog"
		aria-modal="true"
		aria-label="Menu"
		tabindex="-1"
		onkeydown={onKeydown}
	>
		<button
			type="button"
			class="absolute inset-0 bg-ink/50"
			aria-label="Close menu"
			onclick={onclose}
			transition:fade={{ duration }}
		></button>

		<div
			bind:this={panelEl}
			class="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col bg-surface shadow-menu"
			transition:fly={{ x: -320, duration }}
		>
			<!-- Drawer header: mirrors the top-bar band -->
			<div class="flex items-center justify-between bg-brand-strong px-4 py-3 text-white">
				<span class="font-display text-base font-semibold">Browse MySoko</span>
				<button
					bind:this={closeButtonEl}
					type="button"
					onclick={onclose}
					aria-label="Close menu"
					class="rounded-control p-1 text-white/90 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
				>
					<svg class="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
						<path
							d="M6 6l8 8M14 6l-8 8"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
						/>
					</svg>
				</button>
			</div>

			<nav class="flex-1 divide-y divide-border overflow-y-auto">
				<!-- Categories: each expands to its subcategories -->
				<div class="py-1">
					<p class={sectionLabel}>Shop by category</p>
					{#each categoryTree as top (top.slug)}
						<details class="group">
							<summary
								class="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-page focus-visible:bg-page focus-visible:outline-none [&::-webkit-details-marker]:hidden"
							>
								{top.name}
								<svg
									class="h-4 w-4 flex-none text-subtle transition-transform group-open:rotate-180"
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
							<div class="pb-1">
								<a
									href={`/c/${top.slug}`}
									class="block py-2 pr-4 pl-8 text-sm text-brand-strong hover:bg-page"
									onclick={onclose}
								>
									All {top.name}
								</a>
								{#each top.children as sub (sub.slug)}
									<a
										href={`/c/${sub.slug}`}
										class="block py-2 pr-4 pl-8 text-sm text-muted transition-colors hover:bg-page hover:text-ink"
										onclick={onclose}
									>
										{sub.name}
									</a>
								{/each}
							</div>
						</details>
					{/each}
				</div>

				<!-- Explore -->
				<div class="py-1">
					<p class={sectionLabel}>Explore</p>
					<a href="/search" class={navItem} onclick={onclose}>Browse all listings</a>
					<a href="/sell" class={navItem} onclick={onclose}>Sell on MySoko</a>
				</div>

				<!-- Account -->
				<div class="py-1">
					<p class={sectionLabel}>Account</p>
					{#if loggedIn}
						<div class="flex items-center gap-2.5 px-4 py-2">
							{#if profile?.avatar_url}
								<img src={profile.avatar_url} alt="" class="h-8 w-8 rounded-pill object-cover" />
							{:else}
								<span
									class="flex h-8 w-8 items-center justify-center rounded-pill bg-brand-tint text-xs font-semibold text-brand-strong"
								>
									{initials(profile?.full_name)}
								</span>
							{/if}
							<span class="truncate text-sm font-medium text-ink">
								{profile?.full_name ?? 'Your account'}
							</span>
						</div>
						<a href="/account" class={navItem} onclick={onclose}>Account</a>
						<a href="/sell/listings" class={navItem} onclick={onclose}>My listings</a>
						<form method="POST" action="/logout" use:enhance onsubmit={onclose}>
							<button type="submit" class={`${navItem} w-full text-left`}>Log out</button>
						</form>
					{:else}
						<a href="/login" class={navItem} onclick={onclose}>Log in</a>
						<a href="/signup" class={navItem} onclick={onclose}>Sign up</a>
					{/if}
				</div>
			</nav>
		</div>
	</div>
{/if}
