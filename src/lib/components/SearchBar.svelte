<script lang="ts">
	// A GET form that navigates to /search?q=… (post-Section 9, the app's single
	// search entry point). No client state — submitting is a normal navigation, so
	// it's back/forward friendly, works without JS, and produces clean URLs even
	// before hydration. (A category scope select was evaluated but dropped: a native
	// GET can't omit an empty `category=`, which polluted URLs and broke the no-JS
	// path — the drawer already covers category navigation.)
	interface Props {
		value?: string;
		placeholder?: string;
		class?: string;
		/** Show the Filters shortcut (a direct link to /search's filter panel) inside
		 *  the bar, so filters are reachable without typing a query first. Omitted on
		 *  /search itself, where the full filter panel already sits right below. */
		showFilters?: boolean;
	}
	let {
		value = '',
		placeholder = 'Search listings…',
		class: klass = '',
		showFilters = true
	}: Props = $props();
</script>

<form action="/search" method="GET" role="search" class={`flex ${klass}`}>
	<div
		class="flex flex-1 items-stretch overflow-hidden rounded-control border border-border bg-surface focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30"
	>
		<input
			type="search"
			name="q"
			{value}
			{placeholder}
			aria-label="Search listings"
			class="h-11 w-full min-w-0 flex-1 bg-transparent px-3 text-sm text-ink placeholder:text-subtle focus:outline-none"
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
		{#if showFilters}
			<a
				href="/search"
				aria-label="Filters"
				class="flex flex-none items-center justify-center border-l border-border px-3.5 text-muted transition-colors hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-inset"
			>
				<svg class="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
					<path
						d="M3 5h14M6 10h8M8 15h4"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
					/>
				</svg>
			</a>
		{/if}
	</div>
</form>
