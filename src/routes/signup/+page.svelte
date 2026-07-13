<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	const errors = $derived<Record<string, string>>(
		form && 'errors' in form ? (form.errors ?? {}) : {}
	);
	const values = $derived(
		(form && 'values' in form ? form.values : undefined) ?? {
			fullName: '',
			email: '',
			phone: ''
		}
	);
</script>

<svelte:head><title>Sign up · Marketplace</title></svelte:head>

<main class="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-4 py-10">
	{#if form && 'success' in form && form.success}
		<div class="rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center">
			<h1 class="text-xl font-semibold text-emerald-900">Check your email</h1>
			<p class="mt-2 text-sm text-emerald-800">
				We sent a verification link to <strong>{form.email}</strong>. Click it to activate your
				account, then sign in.
			</p>
			<a href="/login" class="mt-4 inline-block text-sm font-medium text-emerald-700 underline">
				Back to login
			</a>
		</div>
	{:else}
		<h1 class="text-2xl font-bold text-gray-900">Create your account</h1>
		<p class="mt-1 text-sm text-gray-600">Buy and sell across Kenya.</p>

		{#if form && 'formError' in form && form.formError}
			<div class="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
				{form.formError}
			</div>
		{/if}

		<form method="POST" use:enhance class="mt-6 space-y-4">
			<div>
				<label for="fullName" class="block text-sm font-medium text-gray-700">Full name</label>
				<input
					id="fullName"
					name="fullName"
					type="text"
					autocomplete="name"
					value={values.fullName ?? ''}
					class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
				/>
				{#if errors.fullName}<p class="mt-1 text-sm text-red-600">{errors.fullName}</p>{/if}
			</div>

			<div>
				<label for="email" class="block text-sm font-medium text-gray-700">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					value={values.email ?? ''}
					class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
				/>
				{#if errors.email}<p class="mt-1 text-sm text-red-600">{errors.email}</p>{/if}
			</div>

			<div>
				<label for="phone" class="block text-sm font-medium text-gray-700">Phone</label>
				<input
					id="phone"
					name="phone"
					type="tel"
					autocomplete="tel"
					placeholder="0712345678"
					value={values.phone ?? ''}
					class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
				/>
				{#if errors.phone}<p class="mt-1 text-sm text-red-600">{errors.phone}</p>{/if}
			</div>

			<div>
				<label for="password" class="block text-sm font-medium text-gray-700">Password</label>
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
					Confirm password
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
				Create account
			</button>
		</form>

		<p class="mt-4 text-center text-sm text-gray-600">
			Already have an account?
			<a href="/login" class="font-medium text-emerald-700 underline">Log in</a>
		</p>
	{/if}
</main>
