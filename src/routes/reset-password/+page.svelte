<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	const errors = $derived(form && 'errors' in form ? (form.errors ?? {}) : {});
</script>

<svelte:head><title>Reset password · Marketplace</title></svelte:head>

<main class="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-4 py-10">
	<h1 class="text-2xl font-bold text-gray-900">Set a new password</h1>
	<p class="mt-1 text-sm text-gray-600">Choose a password of at least 8 characters.</p>

	{#if form && 'formError' in form && form.formError}
		<div class="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
			{form.formError}
		</div>
	{/if}

	<form method="POST" use:enhance class="mt-6 space-y-4">
		<div>
			<label for="password" class="block text-sm font-medium text-gray-700">New password</label>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="new-password"
				class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
			/>
			{#if errors.password}<p class="mt-1 text-sm text-red-600">{errors.password}</p>{/if}
		</div>

		<div>
			<label for="confirmPassword" class="block text-sm font-medium text-gray-700">
				Confirm new password
			</label>
			<input
				id="confirmPassword"
				name="confirmPassword"
				type="password"
				autocomplete="new-password"
				class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
			/>
			{#if errors.confirmPassword}
				<p class="mt-1 text-sm text-red-600">{errors.confirmPassword}</p>
			{/if}
		</div>

		<button
			type="submit"
			class="w-full rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
		>
			Update password
		</button>
	</form>
</main>
