<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	/**
	 * Password field with a show/hide toggle. Drop-in for the base <Input> on any
	 * password field: same value binding, error, and pass-through attributes
	 * (name, autocomplete, id). The toggle is a type="button" so it never submits,
	 * and it flips the SAME input between password/text (not two elements) so
	 * browser autofill and the password manager keep working.
	 */
	interface Props extends HTMLInputAttributes {
		value?: string;
		/** Field error message; renders below and flags the control invalid. */
		error?: string;
		class?: string;
	}

	let { value = $bindable(''), error, class: klass = '', id, ...rest }: Props = $props();

	const errorId = $derived(error && id ? `${id}-error` : undefined);
	let visible = $state(false);

	// pr-11 leaves room for the toggle button so text never runs under it.
	const base =
		'block h-11 w-full rounded-control border bg-surface pl-3 pr-11 text-sm text-ink placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 focus:ring-brand/30';
</script>

<div class="relative">
	<input
		{id}
		type={visible ? 'text' : 'password'}
		bind:value
		class={`${base} ${error ? 'border-error focus:border-error focus:ring-error/30' : 'border-border focus:border-brand'} ${klass}`}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={errorId}
		{...rest}
	/>
	<button
		type="button"
		onclick={() => (visible = !visible)}
		aria-label={visible ? 'Hide password' : 'Show password'}
		aria-pressed={visible}
		class="absolute top-1/2 right-1 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-control text-subtle transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
	>
		<svg class="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
			{#if visible}
				<!-- eye-off -->
				<path
					d="M8.2 4.3a6.9 6.9 0 0 1 1.8-.2c4 0 6.9 3.2 7.7 4.5.2.3.2.7 0 1a13 13 0 0 1-1.9 2.2M11.7 11.9a2.5 2.5 0 0 1-3.5-3.5"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
				<path
					d="M5.5 5.7C3.7 6.9 2.6 8.4 2.3 8.9a.9.9 0 0 0 0 1c.8 1.3 3.7 4.5 7.7 4.5 1.1 0 2.1-.2 3-.6"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
				<path d="M3.5 3.5l13 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
			{:else}
				<!-- eye -->
				<path
					d="M2.3 9.5C3.1 8.2 6 5 10 5s6.9 3.2 7.7 4.5c.2.3.2.7 0 1C16.9 11.8 14 15 10 15s-6.9-3.2-7.7-4.5a.9.9 0 0 1 0-1z"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linejoin="round"
				/>
				<circle cx="10" cy="10" r="2.4" stroke="currentColor" stroke-width="1.5" />
			{/if}
		</svg>
	</button>
</div>
{#if error}
	<p id={errorId} class="mt-1 text-sm text-error">{error}</p>
{/if}
