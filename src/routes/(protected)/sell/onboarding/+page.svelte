<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head><title>Become a seller · Marketplace</title></svelte:head>

<main class="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-10">
	<h1 class="text-2xl font-bold text-gray-900">Become a seller</h1>
	<p class="mt-2 text-sm text-gray-600">
		Upgrade your account to list items for sale on Marketplace. You can start selling right away —
		we'll ask for more details when you create your first listing.
	</p>

	{#if form?.error}
		<div class="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
			{form.error}
		</div>
	{/if}

	<form method="POST" use:enhance class="mt-6">
		<button
			type="submit"
			class="w-full rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
		>
			Upgrade to a seller account
		</button>
	</form>

	<a href="/account" class="mt-4 text-center text-sm font-medium text-emerald-700 underline">
		Not now — back to my account
	</a>
</main>
