<script lang="ts">
	import { enhance } from '$app/forms';
	import { AuthCard } from '$lib/components';
	import { Button, Input, Label, PasswordInput } from '$lib/components/ui';
	import { notifyFromResult } from '$lib/toast.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
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

	// Form-level failures surface as a toast; field errors stay inline below.
	const onSubmit: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await update();
			notifyFromResult(result);
		};
</script>

<svelte:head><title>Sign up · MySoko</title></svelte:head>

{#if form && 'success' in form && form.success}
	<AuthCard title="Check your email">
		<p class="text-sm text-muted">
			We sent a verification link to <strong class="text-ink">{form.email}</strong>. Click it to
			activate your account, then sign in.
		</p>
		<Button href="/login" variant="secondary" class="mt-6 w-full">Back to login</Button>
	</AuthCard>
{:else}
	<AuthCard title="Create your account" subtitle="Buy and sell across Kenya.">
		<form method="POST" use:enhance={onSubmit} class="space-y-4">
			<div>
				<Label for="fullName">Full name</Label>
				<Input
					id="fullName"
					name="fullName"
					type="text"
					autocomplete="name"
					value={values.fullName ?? ''}
					error={errors.fullName}
				/>
			</div>

			<div>
				<Label for="email">Email</Label>
				<Input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					value={values.email ?? ''}
					error={errors.email}
				/>
			</div>

			<div>
				<Label for="phone">Phone</Label>
				<Input
					id="phone"
					name="phone"
					type="tel"
					autocomplete="tel"
					placeholder="0712345678"
					value={values.phone ?? ''}
					error={errors.phone}
				/>
			</div>

			<div>
				<Label for="password">Password</Label>
				<PasswordInput
					id="password"
					name="password"
					autocomplete="new-password"
					error={errors.password}
				/>
			</div>

			<Button type="submit" class="w-full">Create account</Button>
		</form>

		<p class="mt-4 text-center text-sm text-muted">
			Already have an account?
			<a href="/login" class="font-medium text-brand hover:underline">Log in</a>
		</p>
	</AuthCard>
{/if}
