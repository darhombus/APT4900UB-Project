<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	const errors = $derived(form && 'errors' in form ? (form.errors ?? {}) : {});
	const emailValue = $derived(form && 'values' in form ? (form.values?.email ?? '') : '');
	const unverified = $derived(form && 'unverified' in form ? form.unverified : false);
	// Preserve ?redirectTo across the POST via a hidden field so the action honours it.
	const redirectTo = $derived(page.url.searchParams.get('redirectTo') ?? '');
</script>

<svelte:head><title>Log in · Marketplace</title></svelte:head>

<main class="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-4 py-10">
	<h1 class="text-2xl font-bold text-gray-900">Log in</h1>
	<p class="mt-1 text-sm text-gray-600">Welcome back.</p>

	{#if page.url.searchParams.get('error') === 'verification_failed'}
		<div class="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
			That verification link was invalid or has expired. Log in to request a new one.
		</div>
	{/if}

	{#if form && 'formError' in form && form.formError}
		<div class="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
			{form.formError}
		</div>
	{/if}

	{#if form && 'resent' in form && form.resent}
		<div class="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
			If that account needs verifying, we've sent a fresh link to {form.email}.
		</div>
	{/if}

	<form method="POST" action="?/login" use:enhance class="mt-6 space-y-4">
		<input type="hidden" name="redirectTo" value={redirectTo} />
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

		<div>
			<div class="flex items-center justify-between">
				<label for="password" class="block text-sm font-medium text-gray-700">Password</label>
				<a href="/forgot-password" class="text-sm text-emerald-700 underline">Forgot password?</a>
			</div>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="current-password"
				class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
			/>
			{#if errors.password}<p class="mt-1 text-sm text-red-600">{errors.password}</p>{/if}
		</div>

		<button
			type="submit"
			class="w-full rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
		>
			Log in
		</button>
	</form>

	{#if unverified}
		<form method="POST" action="?/resend" use:enhance class="mt-3">
			<input type="hidden" name="email" value={emailValue} />
			<button type="submit" class="text-sm font-medium text-emerald-700 underline">
				Resend verification email
			</button>
			{#if form && 'resendError' in form && form.resendError}
				<p class="mt-1 text-sm text-red-600">{form.resendError}</p>
			{/if}
		</form>
	{/if}

	<p class="mt-4 text-center text-sm text-gray-600">
		Don't have an account?
		<a href="/signup" class="font-medium text-emerald-700 underline">Sign up</a>
	</p>
</main>
