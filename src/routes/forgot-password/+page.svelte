<script lang="ts">
	import { enhance } from '$app/forms';
	import { AuthCard } from '$lib/components';
	import { Button, Input, Label } from '$lib/components/ui';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	const errors = $derived(form && 'errors' in form ? (form.errors ?? {}) : {});
	const emailValue = $derived(form && 'values' in form ? (form.values?.email ?? '') : '');

	// Guard against firing multiple reset emails. `sending` drives the button's
	// loading/disabled state; `inFlight` is a synchronous flag so rapid repeat
	// clicks (before Svelte re-renders the disabled button) are cancelled outright
	// instead of each dispatching another resetPasswordForEmail — the cause of the
	// "clicking send sends multiple emails" report.
	let sending = $state(false);
	let inFlight = false;
	const submit: SubmitFunction = ({ cancel }) => {
		if (inFlight) return cancel();
		inFlight = true;
		sending = true;
		return async ({ update }) => {
			await update();
			inFlight = false;
			sending = false;
		};
	};
</script>

<svelte:head><title>Forgot password · MySoko</title></svelte:head>

{#if form && 'sent' in form && form.sent}
	<AuthCard title="Check your email">
		<p class="text-sm text-muted">
			If an account exists for that address, we've sent a link to reset your password.
		</p>
		<Button href="/login" variant="secondary" class="mt-6 w-full">Back to login</Button>
	</AuthCard>
{:else}
	<AuthCard
		title="Forgot your password?"
		subtitle="Enter your email and we'll send you a link to reset it."
	>
		<form method="POST" use:enhance={submit} class="space-y-4">
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

			<Button type="submit" loading={sending} class="w-full">Send reset link</Button>
		</form>

		<p class="mt-4 text-center text-sm text-muted">
			<a href="/login" class="font-medium text-brand hover:underline">Back to login</a>
		</p>
	</AuthCard>
{/if}
