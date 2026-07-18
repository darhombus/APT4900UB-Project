<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui';

	const isNotFound = $derived(page.status === 404);
</script>

<svelte:head><title>{page.status} · MySoko</title></svelte:head>

<main
	class="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 py-16 text-center"
>
	<p class="font-display text-6xl font-bold text-brand">{page.status}</p>
	<h1 class="mt-3 font-display text-xl font-bold text-ink">
		{isNotFound ? 'Page not found' : 'Something went wrong'}
	</h1>
	<p class="mt-2 text-sm text-muted">
		{isNotFound
			? 'The listing or page you’re looking for isn’t here — it may have been removed or the link is wrong.'
			: (page.error?.message ?? 'An unexpected error occurred. Please try again.')}
	</p>
	<Button href="/" class="mt-6">Back to home</Button>
</main>
