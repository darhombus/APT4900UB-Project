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

<svelte:head><title>Your sales · MySoko</title></svelte:head>

<main class="mx-auto max-w-4xl px-4 py-6 sm:py-8">
	<h1 class="font-display text-2xl font-bold text-ink">Your sales</h1>

	{#if data.sales.length === 0}
		<Card class="mt-6 p-8 text-center">
			<p class="text-sm text-muted">No sales yet. They'll show up here once a buyer pays.</p>
			<div class="mt-4">
				<Button href="/sell/listings" variant="secondary">Your listings</Button>
			</div>
		</Card>
	{:else}
		<Card class="mt-6 flex items-baseline justify-between gap-4 p-4">
			<span class="text-sm text-muted">Earned from completed orders</span>
			<Price amount={centsToMajor(data.completedNet)} size="lg" />
		</Card>

		<!-- Cards on small screens, a table from sm up: the split is five numbers
		     per row, which a phone-width table can't show without scrolling. -->
		<ul class="mt-4 space-y-3 sm:hidden">
			{#each data.sales as sale (sale.id)}
				<li>
					<Card class="p-3">
						<div class="flex items-center gap-3">
							<img
								src={sale.coverUrl ?? PLACEHOLDER_IMAGE}
								alt=""
								class="h-12 w-12 flex-none rounded-control border border-border object-cover"
							/>
							<div class="min-w-0 flex-1">
								<p class="truncate font-medium text-ink">{sale.title}</p>
								<p class="text-xs text-subtle">
									{sale.buyerName} · {dateFmt.format(new Date(sale.createdAt))}
								</p>
							</div>
							<Badge variant={orderStatusVariant(sale.status)}>
								{orderStatusLabel(sale.status)}
							</Badge>
						</div>
						<dl class="mt-3 space-y-1 border-t border-border pt-3 text-sm">
							<div class="flex justify-between gap-4">
								<dt class="text-muted">Total</dt>
								<dd class="text-ink"><Price amount={centsToMajor(sale.amountTotal)} /></dd>
							</div>
							<div class="flex justify-between gap-4">
								<dt class="text-muted">Platform fee</dt>
								<dd class="text-subtle">
									{#if sale.commissionAmount === null}—{:else}
										<Price amount={centsToMajor(sale.commissionAmount)} />
									{/if}
								</dd>
							</div>
							<div class="flex justify-between gap-4">
								<dt class="font-medium text-ink">You receive</dt>
								<dd class="font-medium text-ink">
									{#if sale.sellerNet === null}—{:else}
										<Price amount={centsToMajor(sale.sellerNet)} />
									{/if}
								</dd>
							</div>
						</dl>
					</Card>
				</li>
			{/each}
		</ul>

		<div class="mt-4 hidden overflow-x-auto sm:block">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-border text-left text-xs text-subtle">
						<th class="py-2 pr-4 font-medium">Listing</th>
						<th class="py-2 pr-4 font-medium">Buyer</th>
						<th class="py-2 pr-4 font-medium">Date</th>
						<th class="py-2 pr-4 text-right font-medium">Total</th>
						<th class="py-2 pr-4 text-right font-medium">Platform fee</th>
						<th class="py-2 pr-4 text-right font-medium">You receive</th>
						<th class="py-2 font-medium">Status</th>
					</tr>
				</thead>
				<tbody>
					{#each data.sales as sale (sale.id)}
						<tr class="border-b border-border last:border-0">
							<td class="py-3 pr-4">
								<div class="flex items-center gap-2">
									<img
										src={sale.coverUrl ?? PLACEHOLDER_IMAGE}
										alt=""
										class="h-9 w-9 flex-none rounded-control border border-border object-cover"
									/>
									<span class="max-w-[16ch] truncate text-ink">{sale.title}</span>
								</div>
							</td>
							<td class="py-3 pr-4 text-ink">{sale.buyerName}</td>
							<td class="py-3 pr-4 text-subtle">{dateFmt.format(new Date(sale.createdAt))}</td>
							<td class="py-3 pr-4 text-right text-ink">
								<Price amount={centsToMajor(sale.amountTotal)} />
							</td>
							<td class="py-3 pr-4 text-right text-subtle">
								{#if sale.commissionAmount === null}—{:else}
									<Price amount={centsToMajor(sale.commissionAmount)} />
								{/if}
							</td>
							<td class="py-3 pr-4 text-right font-medium text-ink">
								{#if sale.sellerNet === null}—{:else}
									<Price amount={centsToMajor(sale.sellerNet)} />
								{/if}
							</td>
							<td class="py-3">
								<Badge variant={orderStatusVariant(sale.status)}>
									{orderStatusLabel(sale.status)}
								</Badge>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</main>
