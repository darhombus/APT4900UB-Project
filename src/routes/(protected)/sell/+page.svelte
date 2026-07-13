<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Sell · Marketplace</title></svelte:head>

<main class="mx-auto max-w-2xl px-4 py-10">
	<h1 class="text-2xl font-bold text-gray-900">Seller dashboard</h1>
	<p class="mt-1 text-sm text-gray-600">
		Signed in as {data.email} · role <strong class="capitalize">{data.role}</strong>
	</p>
	<div class="mt-6 rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500">
		Your listings and sales will appear here. (Listings arrive in a later phase.)
	</div>
</main>
