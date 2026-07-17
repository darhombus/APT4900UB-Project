<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { AuthCard } from '$lib/components';
	import { Alert, Button, Input, Label } from '$lib/components/ui';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	const errors = $derived(form && 'errors' in form ? (form.errors ?? {}) : {});
	const emailValue = $derived(form && 'values' in form ? (form.values?.email ?? '') : '');
	const unverified = $derived(form && 'unverified' in form ? form.unverified : false);
	// Preserve ?redirectTo across the POST via a hidden field so the action honours it.
	const redirectTo = $derived(page.url.searchParams.get('redirectTo') ?? '');
</script>

<svelte:head><title>Log in · MySoko</title></svelte:head>

<AuthCard title="Log in" subtitle="Welcome back.">
	{#if page.url.searchParams.get('error') === 'verification_failed'}
		<Alert variant="warning" class="mb-4">
			That verification link was invalid or has expired. Log in to request a new one.
		</Alert>
	{/if}

	{#if form && 'formError' in form && form.formError}
		<Alert variant="error" class="mb-4">{form.formError}</Alert>
	{/if}

	{#if form && 'resent' in form && form.resent}
		<Alert variant="success" class="mb-4">
			If that account needs verifying, we've sent a fresh link to {form.email}.
		</Alert>
	{/if}

	<form method="POST" action="?/login" use:enhance class="space-y-4">
		<input type="hidden" name="redirectTo" value={redirectTo} />
		<div>
			<Label for="email">Email</Label>
			<Input
				id="email"
				name="email"
				type="email"
				autocomplete="email"
				value={emailValue}
				error={errors.email}
			/>
		</div>

		<div>
			<div class="mb-1 flex items-center justify-between">
				<Label for="password" class="mb-0">Password</Label>
				<a href="/forgot-password" class="text-sm font-medium text-brand hover:underline">
					Forgot password?
				</a>
			</div>
			<Input
				id="password"
				name="password"
				type="password"
				autocomplete="current-password"
				error={errors.password}
			/>
		</div>

		<Button type="submit" class="w-full">Log in</Button>
	</form>

	{#if unverified}
		<form method="POST" action="?/resend" use:enhance class="mt-3">
			<input type="hidden" name="email" value={emailValue} />
			<button type="submit" class="text-sm font-medium text-brand hover:underline">
				Resend verification email
			</button>
			{#if form && 'resendError' in form && form.resendError}
				<p class="mt-1 text-sm text-error">{form.resendError}</p>
			{/if}
		</form>
	{/if}

	<p class="mt-4 text-center text-sm text-muted">
		Don't have an account?
		<a href="/signup" class="font-medium text-brand hover:underline">Sign up</a>
	</p>
</AuthCard>
