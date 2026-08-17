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
	// The switch shows the server's value, overridden by an in-flight change so it
	// does not snap back mid-round-trip. Clearing `pending` after `update()` hands
	// authority back to the server rather than leaving a local copy to drift.
	let pending = $state<boolean | null>(null);
	const emailActivity = $derived(pending ?? data.emailActivity);

	const onEmailActivity: SubmitFunction = ({ formData }) => {
		const next = formData.get('emailActivity') === 'on';
		pending = next;
		return async ({ result, update }) => {
			await update();
			pending = null;
			outcome(result, next ? 'Activity emails are on' : 'Activity emails are off');
		};
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

<svelte:head><title>Your account · MySoko</title></svelte:head>

<main class="mx-auto max-w-2xl space-y-8 px-4 py-10">
	<!-- ADM-40 — /account merged into this page, so this is now THE account page
	     and the heading says so.

	     THE TWO FACTS THIS PAGE CANNOT CHANGE SIT IN THE HEADER, not in a fifth
	     card. Your email address and your role are the account's identity; every
	     Card below is something you edit. Keeping them as page context rather
	     than as another section is what stops the merge reading as two pages
	     stapled together — a reader sees who they are, then what they can
	     change. -->
	<div>
		<h1 class="font-display text-2xl font-bold text-ink">Your account</h1>
		<p class="mt-1 text-sm text-muted">Your details, photo, email preferences, and password.</p>

		<dl class="mt-4 flex flex-wrap items-center gap-x-8 gap-y-2">
			<div class="flex min-w-0 items-baseline gap-2">
				<!-- "Email address", never bare "Email": the notification toggle below
				     is also about email, and one word for both controls would make an
				     address and a preference read as the same thing. -->
				<dt class="flex-none text-sm text-muted">Email address</dt>
				<dd class="min-w-0 truncate text-sm font-medium text-ink">{data.email}</dd>
			</div>
			<div class="flex items-center gap-2">
				<dt class="text-sm text-muted">Role</dt>
				<dd><Badge variant="brand" class="capitalize">{data.role ?? 'buyer'}</Badge></dd>
			</div>
		</dl>
	</div>

	<!-- Buyers only, gate unchanged from /account. It sits directly under the role
	     it follows from — "you are a buyer, here is the one thing you can become"
	     — rather than at the foot of the page where a buyer would never scroll. -->
	{#if data.role === 'buyer'}
		<Card>
			<h2 class="text-lg font-semibold text-ink">Start selling</h2>
			<p class="mt-1 text-sm text-muted">
				Sellers list items and services, take payments, and get paid out to Mpesa.
			</p>
			<Button href="/sell" class="mt-4">Become a seller</Button>
		</Card>
	{/if}

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

			<!-- ADM-40: the email address and role badge used to sit HERE, read-only,
			     inside the form that saves the editable fields — styled like the
			     labels above them and submitting nothing. They now live in the page
			     header, where nothing around them is editable. This form contains
			     only what "Save changes" actually writes. -->
			<Button type="submit">Save changes</Button>
		</form>
	</Card>

	<!-- ── Email notifications (NTF-4) ─────────────────────────────────────── -->
	<!-- Titled "Email notifications", not "Email" (ADM-40). Since the merge, the
	     header above shows the account's email ADDRESS, and two sections both
	     headed "Email" would read as one control split in half — one is who we
	     write to, this one is whether we write at all. -->
	<Card>
		<h2 class="text-lg font-semibold text-ink">Email notifications</h2>

		<form
			method="POST"
			action="?/updateEmailActivity"
			use:enhance={onEmailActivity}
			class="mt-4 flex items-start justify-between gap-6"
		>
			<div class="min-w-0">
				<Label for="emailActivity" class="text-ink">Activity emails</Label>
				<p class="mt-1 text-sm text-muted">
					Get an email when you receive a review, when a seller replies to yours, and when an order
					or a boost needs your attention.
				</p>
				<!-- Says plainly what the switch does NOT cover, because the alternative
				     is a user turning it off and then being surprised by a receipt. -->
				<p class="mt-2 text-xs text-subtle">
					Receipts for payments, payouts and boosts are always sent.
				</p>
			</div>

			<!-- Submits on change: a lone switch that needed a Save button beside it
			     would leave people believing they had changed something when they
			     had not. -->
			<input
				id="emailActivity"
				name="emailActivity"
				type="checkbox"
				data-testid="email-activity-toggle"
				checked={emailActivity}
				onchange={(e) => e.currentTarget.form?.requestSubmit()}
				class="mt-1 h-5 w-5 flex-none cursor-pointer rounded-control border-border text-brand accent-brand focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
			/>
			<noscript>
				<Button type="submit" variant="secondary" size="sm">Save</Button>
			</noscript>
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
