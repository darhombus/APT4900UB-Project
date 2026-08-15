<script lang="ts">
	import { enhance } from '$app/forms';
	import { Alert, Avatar, Badge, Button, Card } from '$lib/components/ui';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);

	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' });

	const average = $derived(
		data.profile.review_count > 0
			? (data.profile.rating_sum / data.profile.review_count).toFixed(1)
			: null
	);
</script>

<svelte:head><title>{data.profile.full_name ?? 'Person'} · Admin · MySoko</title></svelte:head>

<div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
	<div class="space-y-4">
		<Card>
			<div class="flex items-center gap-3">
				<Avatar
					src={data.profile.avatar_url}
					name={data.profile.full_name ?? 'Unknown'}
					size="lg"
				/>
				<div class="min-w-0">
					<h2 class="truncate font-display text-lg font-semibold text-ink">
						{data.profile.full_name ?? 'No name set'}
					</h2>
					<div class="mt-1 flex flex-wrap items-center gap-2">
						<Badge variant={data.profile.role === 'admin' ? 'brand' : 'neutral'}>
							{data.profile.role}
						</Badge>
						<span class="text-xs text-subtle">
							Joined {dateFmt.format(new Date(data.profile.created_at))}
						</span>
					</div>
				</div>
			</div>

			{#if average}
				<p class="mt-4 text-sm text-muted">
					{average} average over {data.profile.review_count}
					{data.profile.review_count === 1 ? 'review' : 'reviews'}
				</p>
			{/if}
		</Card>

		<!-- The reveal is a deliberate click, never an automatic load: every one is
		     a logged pii_read, and the log should record looking, not navigating. -->
		<Card>
			<h2 class="font-display text-sm font-semibold text-ink">Private details</h2>

			{#if form?.revealError}
				<Alert variant="error" class="mt-3">{form.revealError}</Alert>
			{:else if form?.revealed}
				<dl class="mt-3 space-y-2 text-sm">
					<div class="flex justify-between gap-2">
						<dt class="text-muted">Phone</dt>
						<dd class="tnum text-ink">{form.phone ?? 'Not provided'}</dd>
					</div>
					<div class="flex justify-between gap-2">
						<dt class="text-muted">Location</dt>
						<dd class="text-ink">{form.location ?? 'Not provided'}</dd>
					</div>
				</dl>
				<p class="mt-3 text-xs text-subtle">This view was recorded in the audit log.</p>
			{:else}
				<p class="mt-2 text-sm text-muted">
					Phone and location are hidden by default. Revealing them is recorded in the audit log
					against your account.
				</p>
				<form
					method="POST"
					action="?/reveal"
					class="mt-3"
					use:enhance={() => {
						submitting = true;
						return async ({ update }) => {
							submitting = false;
							await update();
						};
					}}
				>
					<Button type="submit" variant="secondary" size="sm" loading={submitting}>
						Reveal private details
					</Button>
				</form>
			{/if}
		</Card>
	</div>

	<aside>
		<Card>
			<h2 class="font-display text-sm font-semibold text-ink">Activity</h2>
			<dl class="mt-3 space-y-2 text-sm">
				<div class="flex justify-between gap-2">
					<dt class="text-muted">Listings</dt>
					<dd class="tnum text-ink">{data.activity.listings}</dd>
				</div>
				<div class="flex justify-between gap-2">
					<dt class="text-muted">Orders bought</dt>
					<dd class="tnum text-ink">{data.activity.ordersAsBuyer}</dd>
				</div>
				<div class="flex justify-between gap-2">
					<dt class="text-muted">Orders sold</dt>
					<dd class="tnum text-ink">{data.activity.ordersAsSeller}</dd>
				</div>
				<div class="flex justify-between gap-2">
					<dt class="text-muted">Disputes opened</dt>
					<dd class="tnum text-ink">{data.activity.disputesOpened}</dd>
				</div>
			</dl>
		</Card>
	</aside>
</div>
