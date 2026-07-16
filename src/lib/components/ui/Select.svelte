<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLSelectAttributes } from 'svelte/elements';

	interface Props extends HTMLSelectAttributes {
		value?: string;
		/** Field error message; renders below and flags the control invalid. */
		error?: string;
		class?: string;
		children: Snippet;
	}

	let { value = $bindable(''), error, class: klass = '', id, children, ...rest }: Props = $props();

	const errorId = $derived(error && id ? `${id}-error` : undefined);

	const base =
		'block h-11 w-full appearance-none rounded-control border bg-surface pl-3 pr-9 text-sm text-ink transition-colors focus:outline-none focus:ring-2 focus:ring-brand/30';
</script>

<div class="relative">
	<select
		{id}
		bind:value
		class={`${base} ${error ? 'border-error focus:border-error focus:ring-error/30' : 'border-border focus:border-brand'} ${klass}`}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={errorId}
		{...rest}
	>
		{@render children()}
	</select>
	<!-- Chevron -->
	<svg
		class="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-subtle"
		viewBox="0 0 20 20"
		fill="none"
		aria-hidden="true"
	>
		<path
			d="M6 8l4 4 4-4"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>
</div>
{#if error}
	<p id={errorId} class="mt-1 text-sm text-error">{error}</p>
{/if}
