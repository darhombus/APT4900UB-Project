<script lang="ts">
	import { ListingCard } from '$lib/components';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Clean URLs: omit `sort` when newest and `page` when 1. Values are URL-safe
	// (a fixed sort key and an integer), so the query string is built directly.
	function urlFor(opts: { page?: number; sort?: string } = {}): string {
		const sort = opts.sort ?? data.sort;
		const page = opts.page ?? data.page;
		const parts: string[] = [];
		if (sort && sort !== 'newest') parts.push(`sort=${sort}`);
		if (page > 1) parts.push(`page=${page}`);
		return parts.length ? `?${parts.join('&')}` : `/c/${data.slug}`;
	}

	const sortOptions = [
		{ key: 'newest', label: 'Newest' },
		{ key: 'price_asc', label: 'Price ↑' },
		{ key: 'price_desc', label: 'Price ↓' }
	] as const;

	// A windowed list of page numbers with ellipses for long ranges.
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
</script>

<svelte:head>
	<title>{data.heading} · MySoko</title>
	<meta
		name="description"
		content={`Browse ${data.heading} listings on MySoko — buy and sell in Nairobi.`}
	/>
</svelte:head>

<main class="mx-auto max-w-6xl px-4 py-6 sm:py-8">
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

	<h1 class="mt-2 font-display text-2xl font-bold text-ink">{data.heading}</h1>

	<!-- Subcategory chips (top-level pages only) -->
	{#if data.subcategories.length > 0}
		<div class="mt-4 flex flex-wrap gap-2">
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

	<!-- Result count + sort -->
	<div class="mt-6 flex flex-wrap items-center justify-between gap-3">
		<p class="text-sm text-subtle">
			{data.total}
			{data.total === 1 ? 'listing' : 'listings'}
		</p>
		<div class="flex items-center gap-1 rounded-control border border-border bg-surface p-0.5">
			{#each sortOptions as opt (opt.key)}
				<a
					href={urlFor({ sort: opt.key, page: 1 })}
					aria-current={data.sort === opt.key ? 'true' : undefined}
					class={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
						data.sort === opt.key ? 'bg-brand text-white' : 'text-muted hover:text-ink'
					}`}
				>
					{opt.label}
				</a>
			{/each}
		</div>
	</div>

	<!-- Grid / empty state -->
	{#if data.listings.length === 0}
		<div class="mt-6 rounded-card border border-dashed border-border bg-surface p-12 text-center">
			<p class="font-medium text-ink">No listings here yet</p>
			<p class="mt-1 text-sm text-muted">
				Nothing is posted in {data.heading} right now. Try another category.
			</p>
		</div>
	{:else}
		<div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
			{#each data.listings as listing (listing.id)}
				<ListingCard {listing} />
			{/each}
		</div>

		<!-- Pagination -->
		{#if data.totalPages > 1}
			<nav class="mt-8 flex items-center justify-center gap-1" aria-label="Pagination">
				{#if data.page > 1}
					<a
						href={urlFor({ page: data.page - 1 })}
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
							href={urlFor({ page: item })}
							class="rounded-control border border-border bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-page"
						>
							{item}
						</a>
					{/if}
				{/each}
				{#if data.page < data.totalPages}
					<a
						href={urlFor({ page: data.page + 1 })}
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
