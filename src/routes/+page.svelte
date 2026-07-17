<script lang="ts">
	import { ListingCard, SearchBar } from '$lib/components';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// A short hint of what's inside each top-level category.
	const hint = (children: { name: string }[]) =>
		children
			.slice(0, 3)
			.map((c) => c.name)
			.join(' · ');
</script>

<svelte:head>
	<title>MySoko — Buy and sell across Nairobi</title>
	<meta
		name="description"
		content="MySoko is Kenya's marketplace for electronics, clothing, household goods, and small services. Browse listings or sell your own."
	/>
</svelte:head>

<main class="mx-auto max-w-6xl px-4 py-6 sm:py-10">
	<!-- Hero: search-forward, the fastest path to finding something -->
	<section class="rounded-card border border-border bg-brand-tint/40 p-6 sm:p-10">
		<h1 class="font-display text-3xl font-bold text-ink sm:text-4xl">
			Buy and sell across Nairobi
		</h1>
		<p class="mt-2 max-w-prose text-sm text-muted sm:text-base">
			Phones, furniture, clothing, and handy local services — find a good deal or list your own in
			minutes.
		</p>

		<SearchBar class="mt-5 max-w-xl" />
	</section>

	<!-- Category entry points -->
	<section class="mt-10">
		<h2 class="font-display text-lg font-semibold text-ink">Browse by category</h2>
		<div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
			{#each data.categoryTree as category (category.id)}
				<a
					href={`/c/${category.slug}`}
					class="group rounded-card border border-border bg-surface p-4 shadow-card transition-colors hover:border-brand focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none"
				>
					<h3 class="font-display font-semibold text-ink group-hover:text-brand">
						{category.name}
					</h3>
					<p class="mt-1 line-clamp-1 text-xs text-subtle">{hint(category.children)}</p>
				</a>
			{/each}
		</div>
	</section>

	<!-- Recently posted -->
	<section class="mt-10">
		<div class="flex items-baseline justify-between">
			<h2 class="font-display text-lg font-semibold text-ink">Recently posted</h2>
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
