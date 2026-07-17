<script lang="ts">
	// A GET form that navigates to /search?q=…. Shared by the header, the home
	// hero, and the top of the search page. No client state — submitting is a
	// normal navigation, so it's back/forward friendly and works without JS.
	interface Props {
		value?: string;
		placeholder?: string;
		/** Header style: compact height, submit on Enter (no visible button). */
		compact?: boolean;
		class?: string;
	}
	let {
		value = '',
		placeholder = 'Search listings…',
		compact = false,
		class: klass = ''
	}: Props = $props();
</script>

<form action="/search" method="GET" role="search" class={`flex gap-2 ${klass}`}>
	<div class="relative flex-1">
		<svg
			class="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-subtle"
			viewBox="0 0 20 20"
			fill="none"
			aria-hidden="true"
		>
			<circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.6" />
			<path d="M17 17l-3.5-3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
		</svg>
		<input
			type="search"
			name="q"
			{value}
			{placeholder}
			aria-label="Search listings"
			class={`w-full rounded-control border border-border bg-surface pr-3 pl-10 text-sm text-ink placeholder:text-subtle focus:border-brand focus:ring-2 focus:ring-brand/30 focus:outline-none ${compact ? 'h-10' : 'h-11'}`}
		/>
	</div>
	{#if compact}
		<button type="submit" class="sr-only">Search</button>
	{:else}
		<button
			type="submit"
			class="inline-flex h-11 flex-none items-center justify-center rounded-control bg-brand px-5 text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none"
		>
			Search
		</button>
	{/if}
</form>
