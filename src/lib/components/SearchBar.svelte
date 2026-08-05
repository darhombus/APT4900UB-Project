<script lang="ts">
	// The search bar: a GET form that navigates to /search?q=… (the app's single
	// search entry point). Submitting is a normal navigation, so it's back/forward
	// friendly, works without JS, and produces clean URLs even before hydration.
	//
	// Both the query box and the Filters panel REFLECT THE CURRENT URL: the bar
	// lives in the root layout, which never re-mounts across in-app navigations, so
	// without binding to the URL the (uncontrolled) filter inputs would keep stale
	// selections forever — filters would appear "stuck" and not clear. Deriving from
	// `page.url` makes the panel always show exactly what's applied, and clear when
	// the URL clears.
	//
	// The Filters control floats inside the bar, just left of the search button. It
	// is a native <details> disclosure (opens AND closes on click, no JS needed).
	// Its panel is a SEPARATE GET form (a sibling, never nested in the search form);
	// with JS, `applyFilters` builds a clean URL and keeps the current query; without
	// JS it still GET-submits to /search. `use:autoClose` adds outside-click/Escape.
	import { CONDITIONS, NAIROBI_AREAS } from '$lib/listing-constants';
	import { page } from '$app/state';
	import { goto, afterNavigate } from '$app/navigation';

	interface CategoryTop {
		name: string;
		slug: string;
		children: { name: string; slug: string }[];
	}

	interface Props {
		/** Explicit query text; defaults to the current URL's `q`. */
		value?: string;
		placeholder?: string;
		class?: string;
		/** Show the Filters disclosure inside the bar. Omitted on /search itself,
		 *  where the full filter panel already sits right below the bar. */
		showFilters?: boolean;
		/** Category taxonomy for the filter panel's category select (from the layout). */
		categoryTree?: CategoryTop[];
	}
	let {
		value,
		placeholder = 'Search listings…',
		class: klass = '',
		showFilters = true,
		categoryTree = []
	}: Props = $props();

	// Current search state, read straight from the URL so the controls always mirror
	// what's applied.
	const sp = $derived(page.url.searchParams);
	const q = $derived(value ?? sp.get('q') ?? '');
	const curCategory = $derived(sp.get('category') ?? '');
	const curLocation = $derived(sp.get('location') ?? '');
	const curMin = $derived(sp.get('min_price') ?? '');
	const curMax = $derived(sp.get('max_price') ?? '');
	const curConditions = $derived(sp.getAll('condition'));

	let filtersEl = $state<HTMLDetailsElement | null>(null);
	let inputEl = $state<HTMLInputElement | null>(null);

	/** What the user has actually typed, which is NOT the same as `q`.
	 *
	 *  The box renders `value={q}` with no two-way binding, so text typed into it
	 *  exists only in the DOM. `applyFilters` used to read `q` — the URL's query —
	 *  and on a page with no `?q=` (the home page, say) that is the empty string,
	 *  so a query typed and then filtered was silently dropped from the URL. The
	 *  search form itself never had this problem: a native GET submit reads the
	 *  DOM, not our state. */
	function typedQuery(): string {
		return (inputEl?.value ?? q).trim();
	}

	/** Re-sync the box to the URL after every in-app navigation.
	 *
	 *  The bar lives in the root layout and never re-mounts, and Svelte only
	 *  rewrites `value={q}` when `q` itself changes — so text typed but never
	 *  submitted would otherwise sit in the box forever, surviving navigation to
	 *  pages that have no query at all. Same rule the filter controls already
	 *  follow: the URL is the truth. */
	afterNavigate(() => {
		if (inputEl && inputEl.value !== q) inputEl.value = q;
	});

	/** Close the disclosure on an outside click or Escape (progressive enhancement;
	 *  the native <details> already toggles open/closed on the summary click). */
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

	// Apply filters as a clean navigation: keep the current text query, drop empty
	// fields, and reset to page 1. Without JS the native GET form submits instead.
	function applyFilters(event: SubmitEvent) {
		event.preventDefault();
		const fd = new FormData(event.currentTarget as HTMLFormElement);
		// Build the query as plain string parts (no mutable URLSearchParams in a
		// component, per the svelte/prefer-svelte-reactivity rule — same approach as
		// $lib/filter-nav). Omit empty fields; page resets to 1 by being absent.
		const enc = encodeURIComponent;
		const parts: string[] = [];
		// The live box, not `q` — see typedQuery(). Filtering must never discard a
		// query the user has typed but not yet submitted.
		const typed = typedQuery();
		if (typed) parts.push(`q=${enc(typed)}`);
		const category = String(fd.get('category') ?? '');
		if (category) parts.push(`category=${enc(category)}`);
		const location = String(fd.get('location') ?? '');
		if (location) parts.push(`location=${enc(location)}`);
		const min = String(fd.get('min_price') ?? '').replace(/[,\s]/g, '');
		if (min) parts.push(`min_price=${enc(min)}`);
		const max = String(fd.get('max_price') ?? '').replace(/[,\s]/g, '');
		if (max) parts.push(`max_price=${enc(max)}`);
		for (const c of fd.getAll('condition')) parts.push(`condition=${enc(String(c))}`);
		if (filtersEl) filtersEl.open = false;
		goto('/search' + (parts.length ? `?${parts.join('&')}` : ''), { keepFocus: true });
	}

	const fieldLabel = 'mb-1 block text-xs font-semibold text-ink';
	const control =
		'h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-ink focus:border-brand focus:ring-2 focus:ring-brand/30 focus:outline-none';
</script>

<div class={`relative flex ${klass}`}>
	<!-- q search: the input + magnifying-glass submit share this one form. The filter
	     disclosure is positioned over the bar (a sibling), so the input reserves room
	     on the right for both the filter icon and the search button. -->
	<form
		action="/search"
		method="GET"
		role="search"
		class="flex flex-1 items-stretch overflow-hidden rounded-control border border-border bg-surface focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30"
	>
		<input
			bind:this={inputEl}
			type="search"
			name="q"
			value={q}
			{placeholder}
			aria-label="Search listings"
			class={`h-11 w-full min-w-0 flex-1 bg-transparent py-2 pl-3 text-sm text-ink placeholder:text-subtle focus:outline-none ${showFilters ? 'pr-11' : 'pr-3'}`}
		/>
		<button
			type="submit"
			aria-label="Search"
			class="flex flex-none items-center justify-center bg-brand px-4 text-white transition-colors hover:bg-brand-hover focus-visible:outline-none"
		>
			<svg class="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
				<circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.8" />
				<path d="M17 17l-3.5-3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
			</svg>
		</button>
	</form>

	{#if showFilters}
		<!-- Floats inside the bar, immediately left of the green search button. -->
		<details
			bind:this={filtersEl}
			use:autoClose
			class="absolute inset-y-0 right-13 flex items-stretch"
		>
			<summary
				aria-label="Filters"
				title="Filters"
				class="flex cursor-pointer list-none items-center px-2.5 text-muted transition-colors hover:text-ink focus-visible:rounded-control focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none [&::-webkit-details-marker]:hidden"
			>
				<svg class="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
					<path
						d="M3 5h14M6 10h8M8 15h4"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
					/>
				</svg>
			</summary>

			<!-- Filter panel: its own GET form (sibling of the q form, not nested).
			     Keyed on the URL so it re-mounts to reflect the applied filters after
			     every navigation (and resets when they're cleared). -->
			<div
				class="absolute top-full right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-card border border-border bg-surface p-4 text-left shadow-menu"
			>
				{#key sp.toString()}
					<form action="/search" method="GET" onsubmit={applyFilters} class="space-y-3.5">
						<!-- Preserve the active text query on the no-JS path. -->
						<input type="hidden" name="q" value={q} />

						{#if categoryTree.length}
							<div>
								<label class={fieldLabel} for="sb-category">Category</label>
								<select id="sb-category" name="category" value={curCategory} class={control}>
									<option value="">Any category</option>
									{#each categoryTree as top (top.slug)}
										<optgroup label={top.name}>
											<option value={top.slug}>All {top.name}</option>
											{#each top.children as sub (sub.slug)}
												<option value={sub.slug}>{sub.name}</option>
											{/each}
										</optgroup>
									{/each}
								</select>
							</div>
						{/if}

						<div>
							<label class={fieldLabel} for="sb-location">Location</label>
							<select id="sb-location" name="location" value={curLocation} class={control}>
								<option value="">Any location</option>
								{#each NAIROBI_AREAS as area (area)}
									<option value={area}>{area}</option>
								{/each}
							</select>
						</div>

						<div>
							<span class={fieldLabel}>Price (KSh)</span>
							<div class="flex items-center gap-2">
								<input
									name="min_price"
									inputmode="numeric"
									placeholder="Min"
									aria-label="Minimum price"
									value={curMin}
									class={control}
								/>
								<span class="text-subtle">–</span>
								<input
									name="max_price"
									inputmode="numeric"
									placeholder="Max"
									aria-label="Maximum price"
									value={curMax}
									class={control}
								/>
							</div>
						</div>

						<fieldset>
							<legend class={fieldLabel}>Condition</legend>
							<div class="grid grid-cols-2 gap-x-3 gap-y-1.5">
								{#each CONDITIONS as c (c.value)}
									<label class="flex items-center gap-2 text-sm text-muted">
										<input
											type="checkbox"
											name="condition"
											value={c.value}
											checked={curConditions.includes(c.value)}
											class="h-4 w-4 rounded-sm border-border text-brand focus:ring-2 focus:ring-brand/30"
										/>
										{c.label}
									</label>
								{/each}
							</div>
						</fieldset>

						<button
							type="submit"
							class="h-10 w-full rounded-control bg-brand text-sm font-semibold text-white transition-colors hover:bg-brand-hover focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none"
						>
							Apply filters
						</button>
					</form>
				{/key}
			</div>
		</details>
	{/if}
</div>
