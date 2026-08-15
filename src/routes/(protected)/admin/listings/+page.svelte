<script lang="ts">
	import { enhance } from '$app/forms';
	import { Alert, Badge, Button, Card, Input, Label, Price, Textarea } from '$lib/components/ui';
	import { toast } from '$lib/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Which listing has its confirmation open. Takedown is destructive to a
	// seller's livelihood, so it does not happen on one click.
	let confirming = $state<string | null>(null);
	let submitting = $state<string | null>(null);

	const chips = [
		{ key: 'all', label: 'All' },
		{ key: 'active', label: 'Active' },
		{ key: 'removed', label: 'Taken down' },
		{ key: 'deleted', label: 'Seller-deleted' }
	];

	const href = (key: string) =>
		`/admin/listings?status=${key}${data.q ? `&q=${encodeURIComponent(data.q)}` : ''}`;
</script>

<svelte:head><title>Listings · Admin · MySoko</title></svelte:head>

<div class="flex flex-wrap items-center justify-between gap-3">
	<nav aria-label="Filter listings" class="flex flex-wrap gap-1">
		{#each chips as chip (chip.key)}
			<a
				href={href(chip.key)}
				aria-current={data.filter === chip.key ? 'true' : undefined}
				class="rounded-pill px-3 py-1 text-sm transition-colors
					{data.filter === chip.key
					? 'bg-brand-tint font-medium text-brand-strong'
					: 'text-muted hover:bg-neutral-tint hover:text-ink'}"
			>
				{chip.label}
			</a>
		{/each}
	</nav>

	<form method="GET" class="flex items-end gap-2">
		<input type="hidden" name="status" value={data.filter} />
		<div>
			<Label for="q" class="sr-only">Search titles</Label>
			<Input id="q" name="q" value={data.q} placeholder="Search titles" />
		</div>
		<Button type="submit" variant="secondary">Search</Button>
	</form>
</div>

{#if form?.actionError}
	<Alert variant="error" class="mt-4">{form.actionError}</Alert>
{/if}

{#if data.listings.length === 0}
	<Card class="mt-4">
		<p class="text-sm font-medium text-ink">No listings match</p>
		<p class="mt-1 text-sm text-muted">Try a different filter or search term.</p>
	</Card>
{:else}
	<ul class="mt-4 space-y-3">
		{#each data.listings as listing (listing.id)}
			<li>
				<Card>
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<!-- The Badge set already distinguishes these two, which is the
								     ADM-10 requirement carried into the UI. -->
								<Badge variant={listing.status as 'active'}>{listing.status}</Badge>
								{#if listing.status === 'removed' && listing.priorStatus}
									<span class="text-xs text-subtle">returns to {listing.priorStatus}</span>
								{/if}
							</div>
							<a
								href="/listings/{listing.id}"
								class="mt-2 block truncate text-sm font-medium text-ink hover:text-brand"
							>
								{listing.title}
							</a>
							<a
								href="/admin/users/{listing.sellerId}"
								class="mt-1 block text-xs text-subtle hover:text-brand"
							>
								{listing.sellerName}
							</a>
						</div>

						<div class="flex shrink-0 flex-col items-end gap-2">
							<Price amount={listing.price} size="sm" />

							{#if listing.status === 'removed'}
								<form
									method="POST"
									action="?/restore"
									use:enhance={() => {
										submitting = listing.id;
										return async ({ update, result }) => {
											submitting = null;
											if (result.type === 'success') toast.success('Listing restored');
											await update();
										};
									}}
								>
									<input type="hidden" name="listingId" value={listing.id} />
									<Button
										type="submit"
										variant="secondary"
										size="sm"
										loading={submitting === listing.id}
									>
										Restore
									</Button>
								</form>
							{:else if listing.status === 'deleted'}
								<!-- Not an admin concern (ADM-10): the seller deleted this. -->
								<span class="text-xs text-subtle">Deleted by seller</span>
							{:else}
								<Button
									variant="secondary"
									size="sm"
									onclick={() => (confirming = confirming === listing.id ? null : listing.id)}
								>
									Take down
								</Button>
							{/if}
						</div>
					</div>

					{#if confirming === listing.id}
						<form
							method="POST"
							action="?/takedown"
							class="mt-4 border-t border-border pt-4"
							use:enhance={() => {
								submitting = listing.id;
								return async ({ update, result }) => {
									submitting = null;
									if (result.type === 'success') {
										confirming = null;
										toast.success('Listing taken down');
									}
									await update();
								};
							}}
						>
							<input type="hidden" name="listingId" value={listing.id} />
							<p class="text-sm font-medium text-ink">Take this listing down?</p>
							<p class="mt-1 text-sm text-muted">
								It disappears from search and its page. The seller is told, and can see your note.
								You can restore it to {listing.status} later.
							</p>

							<div class="mt-3">
								<Label for="note-{listing.id}">Reason for the seller</Label>
								<Textarea
									id="note-{listing.id}"
									name="note"
									rows={2}
									placeholder="What is wrong with this listing."
								/>
							</div>

							<div class="mt-3 flex gap-2">
								<Button
									type="submit"
									variant="destructive"
									size="sm"
									loading={submitting === listing.id}
								>
									Take down
								</Button>
								<Button variant="ghost" size="sm" onclick={() => (confirming = null)}>Cancel</Button
								>
							</div>
						</form>
					{/if}
				</Card>
			</li>
		{/each}
	</ul>
{/if}
