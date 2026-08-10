<script lang="ts">
	import { Badge, Button, Card } from '$lib/components/ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const dateFmt = new Intl.DateTimeFormat('en-KE', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
</script>

<svelte:head><title>Boost payment · MySoko</title></svelte:head>

<main class="mx-auto max-w-md px-4 py-10">
	<Card>
		{#if data.state === 'success'}
			<div class="flex items-center gap-2">
				<Badge variant="featured">Featured</Badge>
				<h1 class="font-display text-xl font-bold text-ink">Boost is live</h1>
			</div>
			<p class="mt-3 text-sm text-muted">
				<span class="font-medium text-ink">{data.listingTitle}</span> now appears above other
				listings in search and category results it matches{#if data.expiresAt}, until
					<span class="font-medium text-ink">{dateFmt.format(new Date(data.expiresAt))}</span>{/if}.
			</p>
		{:else if data.state === 'pending'}
			<h1 class="font-display text-xl font-bold text-ink">Confirming your payment</h1>
			<p class="mt-3 text-sm text-muted">
				We haven't had confirmation from Paystack yet. This usually takes a few seconds — refresh
				this page, and the boost starts as soon as the payment clears. Nothing has been charged
				twice.
			</p>
		{:else}
			<h1 class="font-display text-xl font-bold text-ink">Payment didn't go through</h1>
			<p class="mt-3 text-sm text-muted">
				The charge for this boost was declined, so <span class="font-medium text-ink"
					>{data.listingTitle}</span
				> hasn't been boosted and you haven't been charged. You can try again with the same or a different
				package.
			</p>
		{/if}

		<div class="mt-6 flex flex-wrap gap-2">
			{#if data.state === 'failed'}
				<Button href={`/sell/listings/${data.listingId}/boost`}>Try again</Button>
				<Button href="/sell/listings" variant="secondary">Back to listings</Button>
			{:else}
				<Button href="/sell/listings">Back to listings</Button>
				<Button href={`/listings/${data.listingId}`} variant="secondary">View listing</Button>
			{/if}
		</div>
	</Card>
</main>
