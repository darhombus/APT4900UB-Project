<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
		size?: 'sm' | 'md' | 'lg';
		loading?: boolean;
		disabled?: boolean;
		type?: 'button' | 'submit' | 'reset';
		/** When set, the button renders as an anchor styled identically. */
		href?: string;
		class?: string;
		children: Snippet;
		[key: string]: unknown;
	}

	let {
		variant = 'primary',
		size = 'md',
		loading = false,
		disabled = false,
		type = 'button',
		href,
		class: klass = '',
		children,
		...rest
	}: Props = $props();

	const base =
		'inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-page';

	const variants: Record<NonNullable<Props['variant']>, string> = {
		primary: 'bg-brand text-white hover:bg-brand-hover',
		secondary: 'border border-border bg-surface text-ink hover:bg-page',
		ghost: 'bg-transparent text-ink hover:bg-neutral-tint',
		destructive: 'bg-error text-white hover:bg-error-hover focus-visible:ring-error'
	};

	const sizes: Record<NonNullable<Props['size']>, string> = {
		sm: 'h-9 px-3 text-sm',
		md: 'h-11 px-4 text-sm',
		lg: 'h-12 px-5 text-base'
	};

	const isDisabled = $derived(disabled || loading);
	const classes = $derived(`${base} ${variants[variant]} ${sizes[size]} ${klass}`);
</script>

{#snippet spinner()}
	<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
		<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
		<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
	</svg>
{/snippet}

{#if href}
	<a
		{href}
		class={`${classes} ${isDisabled ? 'pointer-events-none opacity-50' : ''}`}
		aria-disabled={isDisabled ? 'true' : undefined}
		{...rest}
	>
		{#if loading}{@render spinner()}{/if}
		{@render children()}
	</a>
{:else}
	<button
		{type}
		class={`${classes} disabled:cursor-not-allowed disabled:opacity-50`}
		disabled={isDisabled}
		aria-busy={loading ? 'true' : undefined}
		{...rest}
	>
		{#if loading}{@render spinner()}{/if}
		{@render children()}
	</button>
{/if}
