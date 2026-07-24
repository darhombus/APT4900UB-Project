<script lang="ts">
	// The search bar: a GET form that navigates to /search?q=… (the app's single
	// search entry point). Submitting is a normal navigation, so it's back/forward
	// friendly, works without JS, and produces clean URLs even before hydration.
	//
	// The Filters control floats inside the bar, just left of the search button. It
	// is a native <details> disclosure: clicking it opens AND closes the filter panel
	// with no JavaScript (the previous version was a plain link that only ever
	// navigated — it "opened" but never closed). Its panel is a SEPARATE GET form
	// (a sibling, never nested inside the search form) that submits the chosen
	// filters to /search. `use:autoClose` adds outside-click / Escape closing when
	// JS is available.
	import { CONDITIONS, NAIROBI_AREAS } from '$lib/listing-constants';

	interface CategoryTop {
		name: string;
		slug: string;
		children: { name: string; slug: string }[];
	}

	interface Props {
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
		value = '',
		placeholder = 'Search listings…',
		class: klass = '',
		showFilters = true,
		categoryTree = []
	}: Props = $props();

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

	const fieldLabel = 'mb-1 block text-xs font-semibold text-ink';
	const control =
		'h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-ink focus:border-brand focus:ring-2 focus:ring-brand/30 focus:outline-none';
</script>

<div class={`relative flex ${klass}`}>
	<!-- q search: the input + magnifying-glass submit share this one form. The filter
	     disclosure is positioned over the bar (a sibling), so the input reserves room
	     on the right (pr-20) for both the filter icon and the search button. -->
	<form
		action="/search"
		method="GET"
		role="search"
		class="flex flex-1 items-stretch overflow-hidden rounded-control border border-border bg-surface focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30"
	>
		<input
			type="search"
			name="q"
			{value}
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
		<details use:autoClose class="absolute inset-y-0 right-[52px] flex items-stretch">
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

			<!-- Filter panel: its own GET form (sibling of the q form, not nested). -->
			<div
				class="absolute top-full right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-card border border-border bg-surface p-4 text-left shadow-menu"
			>
				<form action="/search" method="GET" class="space-y-3.5">
					{#if categoryTree.length}
						<div>
							<label class={fieldLabel} for="sb-category">Category</label>
							<select id="sb-category" name="category" class={control}>
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
						<select id="sb-location" name="location" class={control}>
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
								class={control}
							/>
							<span class="text-subtle">–</span>
							<input
								name="max_price"
								inputmode="numeric"
								placeholder="Max"
								aria-label="Maximum price"
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
			</div>
		</details>
	{/if}
</div>
