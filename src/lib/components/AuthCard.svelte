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

<main class="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-4 py-12">
	<Card>
		<h1 class="font-display text-2xl font-bold text-ink">{title}</h1>
		{#if subtitle}<p class="mt-1 text-sm text-muted">{subtitle}</p>{/if}
		<div class="mt-6">
			{@render children()}
		</div>
	</Card>
</main>
