<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** When set, the whole card becomes a link (used by listing cards). */
		href?: string;
		/** Adds inner padding. Turn off for cards with edge-to-edge media. */
		padded?: boolean;
		class?: string;
		children: Snippet;
		[key: string]: unknown;
	}

	let { href, padded = true, class: klass = '', children, ...rest }: Props = $props();

	const base = 'rounded-card border border-border bg-surface shadow-card';
	const pad = $derived(padded ? 'p-5' : '');
	const interactive =
		'block transition-shadow transition-colors hover:border-subtle/40 hover:shadow-menu focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-page';
</script>

{#if href}
	<a {href} class={`${base} ${pad} ${interactive} ${klass}`} {...rest}>
		{@render children()}
	</a>
{:else}
	<div class={`${base} ${pad} ${klass}`} {...rest}>
		{@render children()}
	</div>
{/if}
