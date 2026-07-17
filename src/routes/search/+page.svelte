<script lang="ts">
	import { goto } from '$app/navigation';
	import { ListingCard, SearchBar } from '$lib/components';
	import { Button, Input, Label, Select } from '$lib/components/ui';
	import { CONDITIONS, conditionLabel } from '$lib/validation/listings';
	import { SEARCH_SORTS, type SearchParams, type SearchSort } from '$lib/search';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const p = $derived(data.params);

	// Mobile-only panel visibility. This is UI state (open/closed), not filter
	// state — the filters themselves live entirely in the URL.
	let filtersOpen = $state(false);

	const enc = encodeURIComponent;
	function toUrl(next: SearchParams): string {
		const parts: string[] = [];
		if (next.q) parts.push(`q=${enc(next.q)}`);
		if (next.category) parts.push(`category=${enc(next.category)}`);
		if (next.minPrice !== null) parts.push(`min_price=${next.minPrice}`);
		if (next.maxPrice !== null) parts.push(`max_price=${next.maxPrice}`);
		for (const c of next.condition) parts.push(`condition=${c}`);
		const defaultSort: SearchSort = next.q ? 'relevance' : 'newest';
		if (next.sort !== defaultSort) parts.push(`sort=${next.sort}`);
		if (next.page > 1) parts.push(`page=${next.page}`);
		return parts.length ? `/search?${parts.join('&')}` : '/search';
	}

	function toInt(v: FormDataEntryValue | null): number | null {
		const s = String(v ?? '').replace(/[,\s]/g, '');
		return /^\d+$/.test(s) && Number(s) > 0 ? Number(s) : null;
	}

	// Progressive enhancement: build a clean URL (no empty params) and navigate.
	// Without JS the form still GET-submits to /search and works.
	function onFilterSubmit(event: SubmitEvent) {
		event.preventDefault();
		const fd = new FormData(event.currentTarget as HTMLFormElement);
		const q = String(fd.get('q') ?? '').trim();
		const sortRaw = String(fd.get('sort') ?? '');
		let sort: SearchSort = SEARCH_SORTS.includes(sortRaw as SearchSort)
			? (sortRaw as SearchSort)
			: q
				? 'relevance'
				: 'newest';
		if (sort === 'relevance' && !q) sort = 'newest';
		goto(
			toUrl({
				q,
				category: String(fd.get('category') ?? ''),
				minPrice: toInt(fd.get('min_price')),
				maxPrice: toInt(fd.get('max_price')),
				condition: fd.getAll('condition').map(String) as SearchParams['condition'],
				sort,
				page: 1
			}),
			{ keepFocus: true }
		);
		filtersOpen = false;
	}

	const sortOptions = $derived(
		(p.q
			? ([
					{ key: 'relevance', label: 'Relevance' },
					{ key: 'newest', label: 'Newest' },
					{ key: 'price_asc', label: 'Price ↑' },
					{ key: 'price_desc', label: 'Price ↓' }
				] as const)
			: ([
					{ key: 'newest', label: 'Newest' },
					{ key: 'price_asc', label: 'Price ↑' },
					{ key: 'price_desc', label: 'Price ↓' }
				] as const)) as ReadonlyArray<{ key: SearchSort; label: string }>
	);

	// Active-filter chips — each links to the same search minus that one filter.
	const chips = $derived.by(() => {
		const out: { label: string; url: string }[] = [];
		if (p.category) {
			out.push({
				label: data.categoryName ?? p.category,
				url: toUrl({ ...p, category: '', page: 1 })
			});
		}
		if (p.minPrice !== null) {
			out.push({
				label: `Min KSh ${p.minPrice.toLocaleString('en-KE')}`,
				url: toUrl({ ...p, minPrice: null, page: 1 })
			});
		}
		if (p.maxPrice !== null) {
			out.push({
				label: `Max KSh ${p.maxPrice.toLocaleString('en-KE')}`,
				url: toUrl({ ...p, maxPrice: null, page: 1 })
			});
		}
		for (const c of p.condition) {
			out.push({
				label: conditionLabel(c),
				url: toUrl({ ...p, condition: p.condition.filter((x) => x !== c), page: 1 })
			});
		}
		return out;
	});

	const clearAllUrl = $derived(
		toUrl({
			q: p.q,
			category: '',
			minPrice: null,
			maxPrice: null,
			condition: [],
			sort: p.q ? 'relevance' : 'newest',
			page: 1
		})
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

{#snippet filterForm()}
	<form method="GET" action="/search" onsubmit={onFilterSubmit} class="space-y-5">
		<input type="hidden" name="q" value={p.q} />
		<input type="hidden" name="sort" value={p.sort} />

		<div>
			<Label for="f-category">Category</Label>
			<Select id="f-category" name="category" value={p.category}>
				<option value="">Any category</option>
				{#each data.categoryTree as top (top.slug)}
					<optgroup label={top.name}>
						<option value={top.slug}>All {top.name}</option>
						{#each top.children as sub (sub.slug)}
							<option value={sub.slug}>{sub.name}</option>
						{/each}
					</optgroup>
				{/each}
			</Select>
		</div>

		<div>
			<span class="mb-1 block text-sm font-medium text-ink">Price (KSh)</span>
			<div class="flex items-center gap-2">
				<Input
					id="f-min"
					name="min_price"
					inputmode="numeric"
					placeholder="Min"
					value={p.minPrice === null ? '' : String(p.minPrice)}
					aria-label="Minimum price"
				/>
				<span class="text-subtle">–</span>
				<Input
					id="f-max"
					name="max_price"
					inputmode="numeric"
					placeholder="Max"
					value={p.maxPrice === null ? '' : String(p.maxPrice)}
					aria-label="Maximum price"
				/>
			</div>
		</div>

		<fieldset>
			<legend class="mb-1 block text-sm font-medium text-ink">Condition</legend>
			<div class="space-y-1.5">
				{#each CONDITIONS as c (c.value)}
					<label class="flex items-center gap-2 text-sm text-muted">
						<input
							type="checkbox"
							name="condition"
							value={c.value}
							checked={p.condition.includes(c.value)}
							class="h-4 w-4 rounded-[4px] border-border text-brand focus:ring-2 focus:ring-brand/30"
						/>
						{c.label}
					</label>
				{/each}
			</div>
		</fieldset>

		<div class="flex items-center gap-3">
			<Button type="submit" size="sm">Apply filters</Button>
			{#if chips.length > 0}
				<a href={clearAllUrl} class="text-sm font-medium text-muted hover:text-ink">Clear all</a>
			{/if}
		</div>
	</form>
{/snippet}

<main class="mx-auto max-w-6xl px-4 py-6 sm:py-8">
	<SearchBar value={p.q} class="max-w-2xl" />

	<!-- Mobile filter toggle -->
	<button
		type="button"
		onclick={() => (filtersOpen = !filtersOpen)}
		class="mt-4 inline-flex items-center gap-2 rounded-control border border-border bg-surface px-3 py-2 text-sm font-medium text-ink lg:hidden"
		aria-expanded={filtersOpen}
	>
		<svg class="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
			<path
				d="M3 5h14M6 10h8M8 15h4"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
			/>
		</svg>
		Filters{chips.length ? ` (${chips.length})` : ''}
	</button>

	<div class="mt-4 lg:grid lg:grid-cols-[15rem_1fr] lg:gap-8">
		<!-- Filter panel: sidebar on desktop, collapsible above the results on mobile -->
		<aside class={`${filtersOpen ? 'block' : 'hidden'} mb-6 lg:mb-0 lg:block`}>
			<div class="rounded-card border border-border bg-surface p-4">
				{@render filterForm()}
			</div>
		</aside>

		<div>
			<!-- Count + sort -->
			<div class="flex flex-wrap items-center justify-between gap-3">
				<p class="text-sm text-muted">
					<span class="font-semibold text-ink">{data.total}</span>
					{data.total === 1 ? 'result' : 'results'}{p.q ? ` for “${p.q}”` : ''}
				</p>
				<div class="flex items-center gap-1 rounded-control border border-border bg-surface p-0.5">
					{#each sortOptions as opt (opt.key)}
						<a
							href={toUrl({ ...p, sort: opt.key, page: 1 })}
							aria-current={p.sort === opt.key ? 'true' : undefined}
							class={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
								p.sort === opt.key ? 'bg-brand text-white' : 'text-muted hover:text-ink'
							}`}
						>
							{opt.label}
						</a>
					{/each}
				</div>
			</div>

			<!-- Active-filter chips -->
			{#if chips.length > 0}
				<div class="mt-3 flex flex-wrap gap-2">
					{#each chips as chip (chip.label)}
						<a
							href={chip.url}
							class="inline-flex items-center gap-1.5 rounded-pill bg-neutral-tint py-1 pr-2 pl-3 text-sm font-medium text-neutral-strong transition-colors hover:bg-border"
						>
							{chip.label}
							<svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
								<path
									d="M6 6l8 8M14 6l-8 8"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
								/>
							</svg>
							<span class="sr-only">Remove filter</span>
						</a>
					{/each}
				</div>
			{/if}

			<!-- Results / empty state -->
			{#if data.listings.length === 0}
				<div
					class="mt-6 rounded-card border border-dashed border-border bg-surface p-12 text-center"
				>
					<p class="font-medium text-ink">
						No results{p.q ? ` for “${p.q}”` : ''}
					</p>
					<p class="mt-1 text-sm text-muted">
						Try broader terms{chips.length ? ', or' : '.'}
						{#if chips.length}<a href={clearAllUrl} class="font-medium text-brand hover:underline"
								>clear your filters</a
							>.{/if}
					</p>
				</div>
			{:else}
				<div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
					{#each data.listings as listing (listing.id)}
						<ListingCard {listing} />
					{/each}
				</div>

				{#if data.totalPages > 1}
					<nav class="mt-8 flex items-center justify-center gap-1" aria-label="Pagination">
						{#if p.page > 1}
							<a
								href={toUrl({ ...p, page: p.page - 1 })}
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
									href={toUrl({ ...p, page: item })}
									class="rounded-control border border-border bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-page"
								>
									{item}
								</a>
							{/if}
						{/each}
						{#if p.page < data.totalPages}
							<a
								href={toUrl({ ...p, page: p.page + 1 })}
								rel="next"
								class="rounded-control border border-border bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-page"
							>
								Next
							</a>
						{/if}
					</nav>
				{/if}
			{/if}
		</div>
	</div>
</main>
