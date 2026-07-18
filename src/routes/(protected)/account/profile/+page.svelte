<script lang="ts">
	import { enhance } from '$app/forms';
	import { AVATAR_TYPES, AVATAR_MAX_BYTES } from '$lib/validation/auth';
	import { Badge, Button, Card, Input, Label, PasswordInput } from '$lib/components/ui';
	import { toast } from '$lib/toast.svelte';
	import type { SubmitFunction, ActionResult } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const profile = $derived(data.profile);

	// Per-section field errors stay inline; outcomes become toasts. Each form knows
	// its own outcome copy, so we key off the ActionResult type rather than `form`.
	const pErrors = $derived(
		form?.section === 'profile' && 'errors' in form ? (form.errors ?? {}) : {}
	);

	function outcome(result: ActionResult, success: string, warn = false): void {
		if (result.type === 'success') {
			toast.success(success);
		} else if (result.type === 'failure') {
			const message = (result.data as { formError?: string } | undefined)?.formError;
			if (message) {
				if (warn) toast.warning(message);
				else toast.error(message);
			}
		}
	}

	const onAvatar: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await update();
			outcome(result, 'Photo updated');
		};
	const onProfile: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await update();
			outcome(result, 'Profile saved');
		};
	// A change-password failure is usually a stale session — a warning, not an error.
	const onPassword: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await update();
			outcome(result, 'Password changed', true);
		};

	function initials(name: string | null | undefined): string {
		if (!name) return '?';
		return name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0]!.toUpperCase())
			.join('');
	}

	// ── Client-side avatar preview + validation (no-JS still works via the action)
	let avatarPreview = $state<string | null>(null);
	let avatarError = $state<string | null>(null);

	function onAvatarChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		avatarPreview = null;
		avatarError = null;
		if (!file) return;
		if (!AVATAR_TYPES.includes(file.type as (typeof AVATAR_TYPES)[number])) {
			avatarError = 'Use a JPEG, PNG, or WebP image.';
			return;
		}
		if (file.size > AVATAR_MAX_BYTES) {
			avatarError = 'Image must be 2 MB or smaller.';
			return;
		}
		avatarPreview = URL.createObjectURL(file);
	}
</script>

<svelte:head><title>Edit profile · MySoko</title></svelte:head>

<main class="mx-auto max-w-2xl space-y-8 px-4 py-10">
	<div>
		<h1 class="font-display text-2xl font-bold text-ink">Edit profile</h1>
		<p class="mt-1 text-sm text-muted">Manage your details, photo, and password.</p>
	</div>

	<!-- ── Photo ───────────────────────────────────────────────────────────── -->
	<Card>
		<h2 class="text-lg font-semibold text-ink">Photo</h2>
		<div class="mt-4 flex items-center gap-5">
			{#if avatarPreview}
				<img
					src={avatarPreview}
					alt="New avatar preview"
					class="h-20 w-20 rounded-pill object-cover"
				/>
			{:else if profile?.avatar_url}
				<img
					src={profile.avatar_url}
					alt="Your avatar"
					class="h-20 w-20 rounded-pill object-cover"
				/>
			{:else}
				<span
					class="flex h-20 w-20 items-center justify-center rounded-pill bg-brand-tint text-xl font-semibold text-brand-strong"
				>
					{initials(profile?.full_name)}
				</span>
			{/if}

			<form
				method="POST"
				action="?/uploadAvatar"
				enctype="multipart/form-data"
				use:enhance={onAvatar}
				class="space-y-2"
			>
				<input
					name="avatar"
					type="file"
					accept="image/jpeg,image/png,image/webp"
					onchange={onAvatarChange}
					class="block w-full text-sm text-muted file:mr-3 file:rounded-control file:border-0 file:bg-brand-tint file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-strong hover:file:opacity-80"
				/>
				<p class="text-xs text-subtle">JPEG, PNG, or WebP · up to 2 MB.</p>
				{#if avatarError}<p class="text-sm text-error">{avatarError}</p>{/if}
				<Button type="submit" size="sm" disabled={!!avatarError}>Upload photo</Button>
			</form>
		</div>
	</Card>

	<!-- ── Details ─────────────────────────────────────────────────────────── -->
	<Card>
		<h2 class="text-lg font-semibold text-ink">Details</h2>

		<form method="POST" action="?/updateProfile" use:enhance={onProfile} class="mt-4 space-y-4">
			<div>
				<Label for="fullName">Full name</Label>
				<Input
					id="fullName"
					name="fullName"
					type="text"
					value={profile?.full_name ?? ''}
					error={pErrors.fullName}
				/>
			</div>

			<div>
				<Label for="phone">Phone</Label>
				<Input
					id="phone"
					name="phone"
					type="tel"
					value={profile?.phone ?? ''}
					error={pErrors.phone}
				/>
			</div>

			<div>
				<Label for="location" optional>Location</Label>
				<Input
					id="location"
					name="location"
					type="text"
					value={profile?.location ?? ''}
					placeholder="e.g. Nairobi"
					error={pErrors.location}
				/>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div>
					<span class="mb-1 block text-sm font-medium text-ink">Email</span>
					<p class="text-sm text-muted">{data.email}</p>
				</div>
				<div>
					<span class="mb-1 block text-sm font-medium text-ink">Role</span>
					<Badge variant="brand"><span class="capitalize">{profile?.role ?? 'buyer'}</span></Badge>
				</div>
			</div>

			<Button type="submit">Save changes</Button>
		</form>
	</Card>

	<!-- ── Password ────────────────────────────────────────────────────────── -->
	<Card>
		<h2 class="text-lg font-semibold text-ink">Change password</h2>

		<form method="POST" action="?/changePassword" use:enhance={onPassword} class="mt-4 space-y-4">
			<div>
				<Label for="password">New password</Label>
				<PasswordInput
					id="password"
					name="password"
					autocomplete="new-password"
					error={form?.section === 'password' && 'errors' in form
						? (form.errors?.password ?? undefined)
						: undefined}
				/>
			</div>
			<div>
				<Label for="confirmPassword">Confirm new password</Label>
				<PasswordInput
					id="confirmPassword"
					name="confirmPassword"
					autocomplete="new-password"
					error={form?.section === 'password' && 'errors' in form
						? (form.errors?.confirmPassword ?? undefined)
						: undefined}
				/>
			</div>
			<Button type="submit">Update password</Button>
		</form>
	</Card>
</main>
