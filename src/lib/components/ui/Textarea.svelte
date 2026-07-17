<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	interface Props extends HTMLTextareaAttributes {
		value?: string;
		/** Field error message; renders below and flags the control invalid. */
		error?: string;
		class?: string;
	}

	let { value = $bindable(''), error, class: klass = '', id, rows = 4, ...rest }: Props = $props();

	const errorId = $derived(error && id ? `${id}-error` : undefined);

	const base =
		'block w-full rounded-control border bg-surface px-3 py-2 text-sm text-ink placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 focus:ring-brand/30';
</script>

<textarea
	{id}
	{rows}
	bind:value
	class={`${base} ${error ? 'border-error focus:border-error focus:ring-error/30' : 'border-border focus:border-brand'} ${klass}`}
	aria-invalid={error ? 'true' : undefined}
	aria-describedby={errorId}
	{...rest}></textarea>
{#if error}
	<p id={errorId} class="mt-1 text-sm text-error">{error}</p>
{/if}
