<script lang="ts">
	import { enhance } from '$app/forms';
	import { AVATAR_TYPES, AVATAR_MAX_BYTES } from '$lib/validation/auth';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const profile = $derived(data.profile);

	// Per-section form feedback (the action tags its result with `section`).
	const pErrors = $derived(
		form?.section === 'profile' && 'errors' in form ? (form.errors ?? {}) : {}
	);

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

<svelte:head><title>Edit profile · Marketplace</title></svelte:head>

<main class="mx-auto max-w-2xl space-y-10 px-4 py-10">
	<div>
		<h1 class="text-2xl font-bold text-gray-900">Edit profile</h1>
		<p class="mt-1 text-sm text-gray-600">Manage your details, photo, and password.</p>
	</div>

	<!-- ── Avatar ──────────────────────────────────────────────────────────── -->
	<section class="rounded-lg border border-gray-200 p-6">
		<h2 class="text-lg font-semibold text-gray-900">Photo</h2>
		<div class="mt-4 flex items-center gap-5">
			{#if avatarPreview}
				<img
					src={avatarPreview}
					alt="New avatar preview"
					class="h-20 w-20 rounded-full object-cover"
				/>
			{:else if profile?.avatar_url}
				<img
					src={profile.avatar_url}
					alt="Your avatar"
					class="h-20 w-20 rounded-full object-cover"
				/>
			{:else}
				<span
					class="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-xl font-semibold text-emerald-800"
				>
					{initials(profile?.full_name)}
				</span>
			{/if}

			<form
				method="POST"
				action="?/uploadAvatar"
				enctype="multipart/form-data"
				use:enhance
				class="space-y-2"
			>
				<input
					name="avatar"
					type="file"
					accept="image/jpeg,image/png,image/webp"
					onchange={onAvatarChange}
					class="block text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-emerald-700 hover:file:bg-emerald-100"
				/>
				<p class="text-xs text-gray-500">JPEG, PNG, or WebP · up to 2 MB.</p>
				{#if avatarError}<p class="text-sm text-red-600">{avatarError}</p>{/if}
				{#if form?.section === 'avatar' && 'formError' in form && form.formError}
					<p class="text-sm text-red-600">{form.formError}</p>
				{/if}
				{#if form?.section === 'avatar' && 'success' in form && form.success}
					<p class="text-sm text-emerald-700">Photo updated.</p>
				{/if}
				<button
					type="submit"
					disabled={!!avatarError}
					class="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
				>
					Upload photo
				</button>
			</form>
		</div>
	</section>

	<!-- ── Details ─────────────────────────────────────────────────────────── -->
	<section class="rounded-lg border border-gray-200 p-6">
		<h2 class="text-lg font-semibold text-gray-900">Details</h2>

		{#if form?.section === 'profile' && 'formError' in form && form.formError}
			<div class="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
				{form.formError}
			</div>
		{/if}
		{#if form?.section === 'profile' && 'success' in form && form.success}
			<div
				class="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
			>
				Profile saved.
			</div>
		{/if}

		<form method="POST" action="?/updateProfile" use:enhance class="mt-4 space-y-4">
			<div>
				<label for="fullName" class="block text-sm font-medium text-gray-700">Full name</label>
				<input
					id="fullName"
					name="fullName"
					type="text"
					value={profile?.full_name ?? ''}
					class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
				/>
				{#if pErrors.fullName}<p class="mt-1 text-sm text-red-600">{pErrors.fullName}</p>{/if}
			</div>

			<div>
				<label for="phone" class="block text-sm font-medium text-gray-700">Phone</label>
				<input
					id="phone"
					name="phone"
					type="tel"
					value={profile?.phone ?? ''}
					class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
				/>
				{#if pErrors.phone}<p class="mt-1 text-sm text-red-600">{pErrors.phone}</p>{/if}
			</div>

			<div>
				<label for="location" class="block text-sm font-medium text-gray-700">
					Location <span class="text-gray-400">(optional)</span>
				</label>
				<input
					id="location"
					name="location"
					type="text"
					value={profile?.location ?? ''}
					placeholder="e.g. Nairobi"
					class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
				/>
				{#if pErrors.location}<p class="mt-1 text-sm text-red-600">{pErrors.location}</p>{/if}
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div>
					<span class="block text-sm font-medium text-gray-700">Email</span>
					<p class="mt-1 text-sm text-gray-500">{data.email}</p>
				</div>
				<div>
					<span class="block text-sm font-medium text-gray-700">Role</span>
					<span
						class="mt-1 inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 capitalize"
					>
						{profile?.role ?? 'buyer'}
					</span>
				</div>
			</div>

			<button
				type="submit"
				class="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700"
			>
				Save changes
			</button>
		</form>
	</section>

	<!-- ── Password ────────────────────────────────────────────────────────── -->
	<section class="rounded-lg border border-gray-200 p-6">
		<h2 class="text-lg font-semibold text-gray-900">Change password</h2>

		{#if form?.section === 'password' && 'formError' in form && form.formError}
			<div class="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
				{form.formError}
				<a href="/forgot-password" class="font-medium underline">Reset by email</a>.
			</div>
		{/if}
		{#if form?.section === 'password' && 'success' in form && form.success}
			<div
				class="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
			>
				Password changed.
			</div>
		{/if}

		<form method="POST" action="?/changePassword" use:enhance class="mt-4 space-y-4">
			<div>
				<label for="password" class="block text-sm font-medium text-gray-700">New password</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="new-password"
					class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
				/>
				{#if form?.section === 'password' && 'errors' in form && form.errors?.password}
					<p class="mt-1 text-sm text-red-600">{form.errors.password}</p>
				{/if}
			</div>
			<div>
				<label for="confirmPassword" class="block text-sm font-medium text-gray-700">
					Confirm new password
				</label>
				<input
					id="confirmPassword"
					name="confirmPassword"
					type="password"
					autocomplete="new-password"
					class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
				/>
				{#if form?.section === 'password' && 'errors' in form && form.errors?.confirmPassword}
					<p class="mt-1 text-sm text-red-600">{form.errors.confirmPassword}</p>
				{/if}
			</div>
			<button
				type="submit"
				class="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700"
			>
				Update password
			</button>
		</form>
	</section>
</main>
