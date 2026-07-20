<script lang="ts">
	import { goto } from '$app/navigation';
	import { navigating } from '$app/state';
	import { Button, Input, Label, Select } from '$lib/components/ui';
	import { CONDITIONS, NAIROBI_AREAS, conditionLabel } from '$lib/validation/listings';
	import type { SearchParams } from '$lib/search';
	import { buildFilterUrl, pricePillState, sortFromParams } from '$lib/filter-nav';

	interface CategoryTop {
		name: string;
		slug: string;
		children: { name: string; slug: string }[];
	}

	interface Props {
		/** Pathname these controls navigate within: `/search` or `/c/<slug>`. */
		base: string;
		/** The current, URL-derived results state (the single source of truth). */
		params: SearchParams;
		/** Rendered result count, e.g. "48 results" — copy differs per page. */
		countText: string;
		/** Show the category select (search only; category pages fix it via the path). */
		showCategory?: boolean;
		categoryTree?: CategoryTop[];
		/** Human name for the active category, for its chip label. */
		categoryName?: string | null;
	}

	let {
		base,
		params,
		countText,
		showCategory = false,
		categoryTree = [],
		categoryName = null
	}: Props = $props();

	const hasQuery = $derived(params.q !== '');

	// Optimistic, click-time state: while a navigation to THIS results page is in
	// flight, reflect the target URL's sort so the pressed pill flips at click time
	// (same technique as the Section 5 management tabs); else the committed sort.
	const navToBase = $derived(navigating.to?.url.pathname === base ? navigating.to.url : null);
	const optimisticSort = $derived(
		navToBase ? sortFromParams(navToBase.searchParams, hasQuery) : params.sort
	);

	// The Price pill: its link is computed from the committed sort (where a click
	// goes), while its label/arrow/active state follow the optimistic sort.
	const priceHref = $derived(
		buildFilterUrl(base, params, { sort: pricePillState(params.sort).nextSort, page: 1 })
	);
	const priceView = $derived(pricePillState(optimisticSort));

	function pillClass(active: boolean): string {
		return `rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
			active ? 'bg-brand text-white' : 'text-muted hover:text-ink'
		}`;
	}

	function toInt(v: FormDataEntryValue | null): number | null {
		const s = String(v ?? '').replace(/[,\s]/g, '');
		return /^\d+$/.test(s) && Number(s) > 0 ? Number(s) : null;
	}

	// Mobile "Filters" sheet — open/closed is UI state only; the filters live in the URL.
	let sheetOpen = $state(false);
	let closeButton = $state<HTMLButtonElement | null>(null);
	$effect(() => {
		if (sheetOpen) closeButton?.focus();
	});

	// Progressive enhancement: build a clean URL (no empty params) and navigate.
	// Without JS the form still GET-submits to `base` and works. Filters reset to page 1.
	function applyFilters(event: SubmitEvent) {
		event.preventDefault();
		const fd = new FormData(event.currentTarget as HTMLFormElement);
		const patch: Partial<SearchParams> = {
			minPrice: toInt(fd.get('min_price')),
			maxPrice: toInt(fd.get('max_price')),
			condition: fd.getAll('condition').map(String) as SearchParams['condition'],
			location: String(fd.get('location') ?? ''),
			page: 1
		};
		if (showCategory) patch.category = String(fd.get('category') ?? '');
		goto(buildFilterUrl(base, params, patch), { keepFocus: true });
		sheetOpen = false;
	}

	// Active-filter chips — each links to the same results minus that one filter.
	const chips = $derived.by(() => {
		const out: { label: string; url: string }[] = [];
		if (showCategory && params.category)
			out.push({
				label: categoryName ?? params.category,
				url: buildFilterUrl(base, params, { category: '', page: 1 })
			});
		if (params.location)
			out.push({
				label: params.location,
				url: buildFilterUrl(base, params, { location: '', page: 1 })
			});
		if (params.minPrice !== null)
			out.push({
				label: `Min KSh ${params.minPrice.toLocaleString('en-KE')}`,
				url: buildFilterUrl(base, params, { minPrice: null, page: 1 })
			});
		if (params.maxPrice !== null)
			out.push({
				label: `Max KSh ${params.maxPrice.toLocaleString('en-KE')}`,
				url: buildFilterUrl(base, params, { maxPrice: null, page: 1 })
			});
		for (const c of params.condition)
			out.push({
				label: conditionLabel(c),
				url: buildFilterUrl(base, params, {
					condition: params.condition.filter((x) => x !== c),
					page: 1
				})
			});
		return out;
	});

	const clearAllUrl = $derived(
		buildFilterUrl(base, params, {
			category: '',
			minPrice: null,
			maxPrice: null,
			condition: [],
			location: '',
			page: 1
		})
	);
</script>

{#snippet filterForm(idPrefix: string)}
	<form
		method="GET"
		action={base}
		onsubmit={applyFilters}
		class="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end lg:gap-4"
	>
		{#if showCategory}
			<div class="w-full lg:w-56">
				<Label for={`${idPrefix}-category`}>Category</Label>
				<Select id={`${idPrefix}-category`} name="category" value={params.category}>
					<option value="">Any category</option>
					{#each categoryTree as top (top.slug)}
						<optgroup label={top.name}>
							<option value={top.slug}>All {top.name}</option>
							{#each top.children as sub (sub.slug)}
								<option value={sub.slug}>{sub.name}</option>
							{/each}
						</optgroup>
					{/each}
				</Select>
			</div>
		{/if}

		<div class="w-full lg:w-48">
			<Label for={`${idPrefix}-location`}>Location</Label>
			<Select id={`${idPrefix}-location`} name="location" value={params.location}>
				<option value="">Any location</option>
				{#each NAIROBI_AREAS as area (area)}
					<option value={area}>{area}</option>
				{/each}
			</Select>
		</div>

		<div>
			<Label for={`${idPrefix}-min`}>Price (KSh)</Label>
			<div class="flex items-center gap-2">
				<div class="w-24">
					<Input
						id={`${idPrefix}-min`}
						name="min_price"
						inputmode="numeric"
						placeholder="Min"
						value={params.minPrice === null ? '' : String(params.minPrice)}
						aria-label="Minimum price"
					/>
				</div>
				<span class="text-subtle">–</span>
				<div class="w-24">
					<Input
						id={`${idPrefix}-max`}
						name="max_price"
						inputmode="numeric"
						placeholder="Max"
						value={params.maxPrice === null ? '' : String(params.maxPrice)}
						aria-label="Maximum price"
					/>
				</div>
			</div>
		</div>

		<fieldset>
			<legend class="mb-1 block text-sm font-medium text-ink">Condition</legend>
			<div class="flex flex-wrap gap-x-4 gap-y-1.5">
				{#each CONDITIONS as c (c.value)}
					<label class="flex items-center gap-2 text-sm text-muted">
						<input
							type="checkbox"
							name="condition"
							value={c.value}
							checked={params.condition.includes(c.value)}
							class="h-4 w-4 rounded-sm border-border text-brand focus:ring-2 focus:ring-brand/30"
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

<svelte:window onkeydown={(e) => e.key === 'Escape' && sheetOpen && (sheetOpen = false)} />

<div class="space-y-4">
	<!-- Desktop: inline filter bar above the grid. -->
	<div class="hidden rounded-card border border-border bg-surface p-4 lg:block">
		{@render filterForm('flt-d')}
	</div>

	<!-- Count + (mobile Filters) + sort pills -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<p class="text-sm text-muted">{countText}</p>

		<div class="flex items-center gap-2">
			<!-- Mobile: one Filters button opening the sheet. -->
			<button
				type="button"
				onclick={() => (sheetOpen = true)}
				class="inline-flex items-center gap-2 rounded-control border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand lg:hidden"
				aria-haspopup="dialog"
				aria-expanded={sheetOpen}
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

			<div
				role="group"
				aria-label="Sort"
				class="flex items-center gap-1 rounded-control border border-border bg-surface p-0.5"
				data-sveltekit-preload-data="hover"
			>
				{#if hasQuery}
					<a
						href={buildFilterUrl(base, params, { sort: 'relevance', page: 1 })}
						aria-current={optimisticSort === 'relevance' ? 'page' : undefined}
						class={pillClass(optimisticSort === 'relevance')}
					>
						Relevance
					</a>
				{/if}
				<a
					href={buildFilterUrl(base, params, { sort: 'newest', page: 1 })}
					aria-current={optimisticSort === 'newest' ? 'page' : undefined}
					class={pillClass(optimisticSort === 'newest')}
				>
					Newest
				</a>
				<a
					href={priceHref}
					aria-current={priceView.active ? 'page' : undefined}
					class={`inline-flex items-center gap-1 ${pillClass(priceView.active)}`}
				>
					{priceView.label}
					{#if priceView.direction === 'asc'}
						<svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
							<path
								d="M6 12l4-4 4 4"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					{:else if priceView.direction === 'desc'}
						<svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
							<path
								d="M6 8l4 4 4-4"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					{/if}
				</a>
			</div>
		</div>
	</div>

	<!-- Active-filter chips -->
	{#if chips.length > 0}
		<div class="flex flex-wrap gap-2">
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
</div>

<!-- Mobile filter sheet -->
{#if sheetOpen}
	<div class="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
		<button
			type="button"
			class="absolute inset-0 bg-ink/40"
			aria-label="Close filters"
			onclick={() => (sheetOpen = false)}
		></button>
		<div
			class="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-card border-t border-border bg-surface p-5 shadow-menu"
		>
			<div class="mb-4 flex items-center justify-between">
				<h2 class="font-display text-lg font-semibold text-ink">Filters</h2>
				<button
					bind:this={closeButton}
					type="button"
					onclick={() => (sheetOpen = false)}
					class="rounded-control p-1.5 text-muted hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
					aria-label="Close filters"
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
			{@render filterForm('flt-m')}
		</div>
	</div>
{/if}
