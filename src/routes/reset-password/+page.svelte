<script lang="ts">
	import { enhance } from '$app/forms';
	import { AuthCard } from '$lib/components';
	import { Alert, Button, Input, Label } from '$lib/components/ui';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	const errors = $derived(form && 'errors' in form ? (form.errors ?? {}) : {});
</script>

<svelte:head><title>Reset password · MySoko</title></svelte:head>

<AuthCard title="Set a new password" subtitle="Choose a password of at least 8 characters.">
	{#if form && 'formError' in form && form.formError}
		<Alert variant="error" class="mb-4">{form.formError}</Alert>
	{/if}

	<form method="POST" use:enhance class="space-y-4">
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
