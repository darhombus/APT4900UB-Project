<script lang="ts">
	import { Badge, Button, Card, Price } from '$lib/components/ui';
	import { PLACEHOLDER_IMAGE } from '$lib/listing-images';
	import { centsToMajor, orderStatusLabel, orderStatusVariant } from '$lib/orders';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const dateFmt = new Intl.DateTimeFormat('en-KE', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
</script>

<svelte:head><title>Your orders · MySoko</title></svelte:head>

<main class="mx-auto max-w-3xl px-4 py-6 sm:py-8">
	<h1 class="font-display text-2xl font-bold text-ink">Your orders</h1>

	{#if data.orders.length === 0}
		<Card class="mt-6 p-8 text-center">
			<p class="text-sm text-muted">You haven't bought anything yet.</p>
			<div class="mt-4">
				<Button href="/">Browse listings</Button>
			</div>
		</Card>
	{:else}
		<ul class="mt-6 space-y-3">
			{#each data.orders as order (order.id)}
				<li>
					<a
						href={`/account/orders/${order.id}`}
						class="flex items-center gap-4 rounded-card border border-border bg-surface p-3 transition-colors hover:bg-page focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
					>
						<img
							src={order.coverUrl ?? PLACEHOLDER_IMAGE}
							alt=""
							class="h-14 w-14 flex-none rounded-control border border-border object-cover"
						/>
						<div class="min-w-0 flex-1">
							<p class="truncate font-medium text-ink">{order.title}</p>
							<p class="mt-0.5 text-xs text-subtle">
								{dateFmt.format(new Date(order.createdAt))}
							</p>
						</div>
						<div class="flex flex-none flex-col items-end gap-1">
							<Price amount={centsToMajor(order.amountTotal)} />
							<Badge variant={orderStatusVariant(order.status)}>
								{orderStatusLabel(order.status)}
							</Badge>
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</main>
