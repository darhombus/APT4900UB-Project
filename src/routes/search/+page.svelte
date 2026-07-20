<script lang="ts">
	import { navigating } from '$app/state';
	import { FilterSortBar, ListingCard, SearchBar } from '$lib/components';
	import { buildFilterUrl } from '$lib/filter-nav';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const p = $derived(data.params);
	const base = '/search';

	const countText = $derived(
		`${data.total} ${data.total === 1 ? 'result' : 'results'}${p.q ? ` for “${p.q}”` : ''}`
	);

	// A navigation to the results page itself (sort/filter/page change) shows the
	// grid skeleton for that window — the header controls flip at click time.
	const loading = $derived(navigating.to?.url.pathname === base);

	const clearAllUrl = $derived(
		buildFilterUrl(base, p, {
			category: '',
			minPrice: null,
			maxPrice: null,
			condition: [],
			location: '',
			page: 1
		})
	);
	const hasFilters = $derived(
		p.category !== '' ||
			p.minPrice !== null ||
			p.maxPrice !== null ||
			p.condition.length > 0 ||
			p.location !== ''
	);

	const pageItems = $derived.by(() => {
		const tp = data.totalPages;
		const cur = p.page;
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
	<title>{p.q ? `“${p.q}” · Search` : 'Search'} · MySoko</title>
	<meta
		name="description"
		content={p.q
			? `Search results for “${p.q}” on MySoko.`
			: 'Search listings on MySoko — Kenya’s marketplace.'}
	/>
</svelte:head>

<main class="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:py-8">
	<SearchBar value={p.q} class="max-w-2xl" />

	<FilterSortBar
		{base}
		params={p}
		{countText}
		showCategory
		categoryTree={data.categoryTree}
		categoryName={data.categoryName}
	/>

	{#if loading}
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-hidden="true">
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
		<span class="sr-only" role="status">Loading results…</span>
	{:else if data.listings.length === 0}
		<div class="rounded-card border border-dashed border-border bg-surface p-12 text-center">
			<p class="font-medium text-ink">No results{p.q ? ` for “${p.q}”` : ''}</p>
			<p class="mt-1 text-sm text-muted">
				Try broader terms{hasFilters ? ', or ' : '.'}{#if hasFilters}<a
						href={clearAllUrl}
						class="font-medium text-brand hover:underline">clear your filters</a
					>.{/if}
			</p>
		</div>
	{:else}
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
			{#each data.listings as listing (listing.id)}
				<ListingCard {listing} />
			{/each}
		</div>

		{#if data.totalPages > 1}
			<nav class="flex items-center justify-center gap-1" aria-label="Pagination">
				{#if p.page > 1}
					<a
						href={buildFilterUrl(base, p, { page: p.page - 1 })}
						rel="prev"
						class="rounded-control border border-border bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-page"
					>
						Prev
					</a>
				{/if}
				{#each pageItems as item, i (i)}
					{#if item === 'gap'}
						<span class="px-2 text-subtle">…</span>
					{:else if item === p.page}
						<span
							aria-current="page"
							class="rounded-control bg-brand px-3.5 py-2 text-sm font-semibold text-white"
						>
							{item}
						</span>
					{:else}
						<a
							href={buildFilterUrl(base, p, { page: item })}
							class="rounded-control border border-border bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-page"
						>
							{item}
						</a>
					{/if}
				{/each}
				{#if p.page < data.totalPages}
					<a
						href={buildFilterUrl(base, p, { page: p.page + 1 })}
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
