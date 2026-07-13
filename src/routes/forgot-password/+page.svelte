<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	const errors = $derived(form && 'errors' in form ? (form.errors ?? {}) : {});
	const emailValue = $derived(form && 'values' in form ? (form.values?.email ?? '') : '');
</script>

<svelte:head><title>Forgot password · Marketplace</title></svelte:head>

<main class="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-4 py-10">
	{#if form && 'sent' in form && form.sent}
		<div class="rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center">
			<h1 class="text-xl font-semibold text-emerald-900">Check your email</h1>
			<p class="mt-2 text-sm text-emerald-800">
				If an account exists for that address, we've sent a link to reset your password.
			</p>
			<a href="/login" class="mt-4 inline-block text-sm font-medium text-emerald-700 underline">
				Back to login
			</a>
		</div>
	{:else}
		<h1 class="text-2xl font-bold text-gray-900">Forgot your password?</h1>
		<p class="mt-1 text-sm text-gray-600">
			Enter your email and we'll send you a link to reset it.
		</p>

		<form method="POST" use:enhance class="mt-6 space-y-4">
			<div>
				<label for="email" class="block text-sm font-medium text-gray-700">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					value={emailValue}
					class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
				/>
				{#if errors.email}<p class="mt-1 text-sm text-red-600">{errors.email}</p>{/if}
			</div>

			<button
				type="submit"
				class="w-full rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
			>
				Send reset link
			</button>
		</form>

		<p class="mt-4 text-center text-sm text-gray-600">
			<a href="/login" class="font-medium text-emerald-700 underline">Back to login</a>
		</p>
	{/if}
</main>
