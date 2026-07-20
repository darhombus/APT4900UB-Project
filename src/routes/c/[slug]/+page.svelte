<script lang="ts">
	import { navigating } from '$app/state';
	import { FilterSortBar, ListingCard } from '$lib/components';
	import { buildFilterUrl } from '$lib/filter-nav';
	import type { SearchParams } from '$lib/search';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const base = $derived(`/c/${data.slug}`);

	// The category page's URL state, shaped like a search: no free-text query, and
	// its category fixed by the path (so the shared bar hides the category select).
	const state: SearchParams = $derived({
		q: '',
		category: '',
		minPrice: data.minPrice,
		maxPrice: data.maxPrice,
		condition: data.condition,
		location: data.location,
		sort: data.sort,
		page: data.page
	});

	const countText = $derived(`${data.total} ${data.total === 1 ? 'listing' : 'listings'}`);
	const loading = $derived(navigating.to?.url.pathname === base);

	const pageItems = $derived.by(() => {
		const { totalPages: tp, page: cur } = data;
		const wanted = [...new Set([1, cur - 1, cur, cur + 1, tp])]
			.filter((n) => n >= 1 && n <= tp)
			.sort((a, b) => a - b);
		const out: (number | 'gap')[] = [];
		let prev = 0;
		for (const n of wanted) {
			if (n - prev > 1) out.push('gap');
			out.push(n);
			prev = n;
		}
		return out;
	});

	const SKELETON_CARDS = [0, 1, 2, 3, 4, 5, 6, 7];
</script>

<svelte:head>
	<title>{data.heading} · MySoko</title>
	<meta
		name="description"
		content={`Browse ${data.heading} listings on MySoko — buy and sell in Nairobi.`}
	/>
</svelte:head>

<main class="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:py-8">
	<div class="space-y-2">
		<!-- Breadcrumb -->
		<nav class="flex flex-wrap items-center gap-1.5 text-sm text-subtle" aria-label="Breadcrumb">
			<a href="/" class="hover:text-ink">Home</a>
			{#if data.parent}
				<span aria-hidden="true">/</span>
				<a href={`/c/${data.parent.slug}`} class="hover:text-ink">{data.parent.name}</a>
			{/if}
			<span aria-hidden="true">/</span>
			<span class="font-medium text-ink">{data.heading}</span>
		</nav>

		<h1 class="font-display text-2xl font-bold text-ink">{data.heading}</h1>
	</div>

	<!-- Subcategory chips (top-level pages only) — the category page's own drill-down. -->
	{#if data.subcategories.length > 0}
		<div class="flex flex-wrap gap-2">
			{#each data.subcategories as sc (sc.slug)}
				<a
					href={`/c/${sc.slug}`}
					class="rounded-pill border border-border bg-surface px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:border-brand hover:text-brand"
				>
					{sc.name}
				</a>
			{/each}
		</div>
	{/if}

	<FilterSortBar {base} params={state} {countText} />

	{#if loading}
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
			{#each SKELETON_CARDS as i (i)}
				<div class="animate-pulse overflow-hidden rounded-card border border-border bg-surface">
					<div class="aspect-square bg-neutral-tint"></div>
					<div class="space-y-2 p-3">
						<div class="h-3.5 w-3/4 rounded bg-neutral-tint"></div>
						<div class="h-3 w-1/3 rounded bg-neutral-tint"></div>
					</div>
				</div>
			{/each}
		</div>
		<span class="sr-only" role="status">Loading listings…</span>
	{:else if data.listings.length === 0}
		<div class="rounded-card border border-dashed border-border bg-surface p-12 text-center">
			<p class="font-medium text-ink">No listings here yet</p>
			<p class="mt-1 text-sm text-muted">
				Nothing matches in {data.heading} right now. Try adjusting your filters.
			</p>
		</div>
	{:else}
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
			{#each data.listings as listing (listing.id)}
				<ListingCard {listing} />
			{/each}
		</div>

		{#if data.totalPages > 1}
			<nav class="flex items-center justify-center gap-1" aria-label="Pagination">
				{#if data.page > 1}
					<a
						href={buildFilterUrl(base, state, { page: data.page - 1 })}
						rel="prev"
						class="rounded-control border border-border bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-page"
					>
						Prev
					</a>
				{/if}
				{#each pageItems as item, i (i)}
					{#if item === 'gap'}
						<span class="px-2 text-subtle">…</span>
					{:else if item === data.page}
						<span
							aria-current="page"
							class="rounded-control bg-brand px-3.5 py-2 text-sm font-semibold text-white"
						>
							{item}
						</span>
					{:else}
						<a
							href={buildFilterUrl(base, state, { page: item })}
							class="rounded-control border border-border bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-page"
						>
							{item}
						</a>
					{/if}
				{/each}
				{#if data.page < data.totalPages}
					<a
						href={buildFilterUrl(base, state, { page: data.page + 1 })}
						rel="next"
						class="rounded-control border border-border bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-page"
					>
						Next
					</a>
				{/if}
			</nav>
		{/if}
	{/if}
</main>
