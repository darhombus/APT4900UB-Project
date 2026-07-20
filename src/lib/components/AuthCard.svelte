<script lang="ts">
	import type { Snippet } from 'svelte';
	import Card from './ui/Card.svelte';

	/**
	 * Shared centered single-column card layout for every auth page (sign-up,
	 * login, password reset, and the sign-up / reset success states) so they read
	 * as one consistent flow inside the app shell.
	 */
	interface Props {
		title: string;
		subtitle?: string;
		children: Snippet;
	}

	let { title, subtitle, children }: Props = $props();
</script>

<main class="mx-auto my-auto w-full max-w-md px-4 py-2.5">
	<Card padded={false} class="p-4">
		<h1 class="font-display text-2xl font-bold text-ink">{title}</h1>
		{#if subtitle}<p class="mt-1 text-sm text-muted">{subtitle}</p>{/if}
		<div class="mt-4">
			{@render children()}
		</div>
	</Card>
</main>
