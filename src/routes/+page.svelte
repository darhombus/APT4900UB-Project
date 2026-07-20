<script lang="ts">
	import { ListingCard } from '$lib/components';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>MySoko — Buy and sell across Nairobi</title>
	<meta
		name="description"
		content="MySoko is Kenya's marketplace for electronics, clothing, household goods, and small services. Browse listings or sell your own."
	/>
</svelte:head>

<main class="mx-auto max-w-6xl px-4 py-6">
	<!-- Category entry points: one horizontal line, scrollable on narrow screens. -->
	<nav
		aria-label="Browse categories"
		class="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
	>
		{#each data.categoryTree as category (category.id)}
			<a
				href={`/c/${category.slug}`}
				class="shrink-0 rounded-pill border border-border bg-surface px-3.5 py-1.5 text-sm font-medium whitespace-nowrap text-muted transition-colors hover:border-brand hover:text-brand focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
			>
				{category.name}
			</a>
		{/each}
	</nav>

	<!-- The listings grid is the page. -->
	<section class="mt-6">
		<div class="flex items-baseline justify-between">
			<h1 class="font-display text-xl font-bold text-ink">Recently posted</h1>
			<a href="/search" class="text-sm font-medium text-brand hover:underline">Browse all</a>
		</div>

		{#if data.recent.length === 0}
			<div class="mt-4 rounded-card border border-dashed border-border bg-surface p-10 text-center">
				<p class="text-sm text-muted">No listings yet — check back soon.</p>
			</div>
		{:else}
			<div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
				{#each data.recent as listing (listing.id)}
					<ListingCard {listing} />
				{/each}
			</div>
		{/if}
	</section>
</main>
