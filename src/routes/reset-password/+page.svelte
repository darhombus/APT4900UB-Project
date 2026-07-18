<script lang="ts">
	import { enhance } from '$app/forms';
	import { AuthCard } from '$lib/components';
	import { Button, Input, Label } from '$lib/components/ui';
	import { notifyFromResult } from '$lib/toast.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	const errors = $derived(form && 'errors' in form ? (form.errors ?? {}) : {});

	// Success redirects to /account with a toast that survives the navigation;
	// a failure toasts its message while field errors stay inline.
	const onSubmit: SubmitFunction =
		() =>
		async ({ result, update }) => {
			notifyFromResult(result, { redirect: 'Password updated' });
			await update();
		};
</script>

<svelte:head><title>Reset password · MySoko</title></svelte:head>

<AuthCard title="Set a new password" subtitle="Choose a password of at least 8 characters.">
	<form method="POST" use:enhance={onSubmit} class="space-y-4">
		<div>
			<Label for="password">New password</Label>
			<Input
				id="password"
				name="password"
				type="password"
				autocomplete="new-password"
				error={errors.password}
			/>
		</div>

		<div>
			<Label for="confirmPassword">Confirm new password</Label>
			<Input
				id="confirmPassword"
				name="confirmPassword"
				type="password"
				autocomplete="new-password"
				error={errors.confirmPassword}
			/>
		</div>

		<Button type="submit" class="w-full">Update password</Button>
	</form>
</AuthCard>
