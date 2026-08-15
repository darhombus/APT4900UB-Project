<script lang="ts">
	import { enhance } from '$app/forms';
	import { Alert, Badge, Button, Card, Stars } from '$lib/components/ui';
	import { toast } from '$lib/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state<string | null>(null);

	const chips = [
		{ key: 'all', label: 'All' },
		{ key: 'visible', label: 'Visible' },
		{ key: 'hidden', label: 'Hidden' }
	];

	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' });
</script>

<svelte:head><title>Reviews · Admin · MySoko</title></svelte:head>

<nav aria-label="Filter reviews" class="flex flex-wrap gap-1">
	{#each chips as chip (chip.key)}
		<a
			href="/admin/reviews?status={chip.key}"
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

{#if form?.actionError}
	<Alert variant="error" class="mt-4">{form.actionError}</Alert>
{/if}

{#if data.reviews.length === 0}
	<Card class="mt-4">
		<p class="text-sm font-medium text-ink">No reviews match</p>
		<p class="mt-1 text-sm text-muted">Try a different filter.</p>
	</Card>
{:else}
	<ul class="mt-4 space-y-3">
		{#each data.reviews as review (review.id)}
			<li>
				<Card>
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<!-- Several ratings on one page, so name the subject for screen readers. -->
								<Stars average={review.rating} subject={review.listingTitle} />
								{#if review.status === 'hidden'}
									<Badge variant="neutral">Hidden</Badge>
								{/if}
							</div>
							<p class="mt-2 whitespace-pre-wrap text-sm text-muted">{review.body}</p>
							<p class="mt-2 text-xs text-subtle">
								{review.buyerName} on {review.listingTitle} ·
								<a class="hover:text-brand" href="/admin/users/{review.sellerId}"
									>{review.sellerName}</a
								>
								· {dateFmt.format(new Date(review.createdAt))}
							</p>
						</div>

						<form
							method="POST"
							action={review.status === 'hidden' ? '?/restore' : '?/hide'}
							class="shrink-0"
							use:enhance={() => {
								submitting = review.id;
								return async ({ update, result }) => {
									submitting = null;
									if (result.type === 'success') {
										toast.success(review.status === 'hidden' ? 'Review restored' : 'Review hidden');
									}
									await update();
								};
							}}
						>
							<input type="hidden" name="reviewId" value={review.id} />
							<Button
								type="submit"
								variant="secondary"
								size="sm"
								loading={submitting === review.id}
							>
								{review.status === 'hidden' ? 'Restore' : 'Hide'}
							</Button>
						</form>
					</div>
				</Card>
			</li>
		{/each}
	</ul>
{/if}
