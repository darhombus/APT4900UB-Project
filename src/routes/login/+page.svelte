<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { AuthCard } from '$lib/components';
	import { Button, Input, Label, PasswordInput } from '$lib/components/ui';
	import { toast, notifyFromResult } from '$lib/toast.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	const errors = $derived(form && 'errors' in form ? (form.errors ?? {}) : {});
	const emailValue = $derived(form && 'values' in form ? (form.values?.email ?? '') : '');
	const unverified = $derived(form && 'unverified' in form ? form.unverified : false);
	// Preserve ?redirectTo across the POST via a hidden field so the action honours it.
	const redirectTo = $derived(page.url.searchParams.get('redirectTo') ?? '');

	// A form-level login failure toasts; the `unverified` flag still drives the
	// inline "Resend verification" control, so update() runs first.
	const onLogin: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await update();
			notifyFromResult(result);
		};

	const onResend: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await update();
			notifyFromResult(result, {
				success: "If that account needs verifying, we've sent a fresh link."
			});
		};

	// A failed email-verification redirect (?error=verification_failed) arrives as a
	// URL param, not a form result — announce it once on mount.
	onMount(() => {
		if (page.url.searchParams.get('error') === 'verification_failed') {
			toast.warning(
				'That verification link was invalid or has expired. Log in to request a new one.'
			);
		}
	});
</script>

<svelte:head><title>Log in · MySoko</title></svelte:head>

<AuthCard title="Log in" subtitle="Welcome back.">
	<form method="POST" action="?/login" use:enhance={onLogin} class="space-y-4">
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
			<PasswordInput
				id="password"
				name="password"
				autocomplete="current-password"
				error={errors.password}
			/>
		</div>

		<Button type="submit" class="w-full">Log in</Button>
	</form>

	{#if unverified}
		<form method="POST" action="?/resend" use:enhance={onResend} class="mt-3">
			<input type="hidden" name="email" value={emailValue} />
			<button type="submit" class="text-sm font-medium text-brand hover:underline">
				Resend verification email
			</button>
		</form>
	{/if}

	<p class="mt-4 text-center text-sm text-muted">
		Don't have an account?
		<a href="/signup" class="font-medium text-brand hover:underline">Sign up</a>
	</p>
</AuthCard>
