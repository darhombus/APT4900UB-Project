<script lang="ts">
	import { Badge, Card, Price } from '$lib/components/ui';
	import { centsToMajor } from '$lib/orders';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const chips = $derived([
		{ key: 'live', label: 'Live', count: data.counts.live },
		{ key: 'open', label: 'Open', count: data.counts.open },
		{ key: 'under_review', label: 'Under review', count: data.counts.under_review },
		{ key: 'resolved', label: 'Resolved', count: data.counts.resolved },
		{ key: 'all', label: 'All', count: data.counts.all }
	]);

	const STATUS: Record<
		string,
		{ label: string; variant: 'warning' | 'brand' | 'success' | 'neutral' }
	> = {
		open: { label: 'Open', variant: 'warning' },
		under_review: { label: 'Under review', variant: 'brand' },
		resolved_refunded: { label: 'Refunded', variant: 'success' },
		resolved_rejected: { label: 'Rejected', variant: 'neutral' }
	};

	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
</script>

<svelte:head><title>Disputes · Admin · MySoko</title></svelte:head>

<!-- The filter is a link set, not a control: each state is a URL an admin can
     bookmark and return to, and the server load reads it. -->
<nav aria-label="Filter disputes" class="flex flex-wrap gap-1">
	{#each chips as chip (chip.key)}
		<a
			href="/admin/disputes?status={chip.key}"
			aria-current={data.filter === chip.key ? 'true' : undefined}
			class="rounded-pill px-3 py-1 text-sm transition-colors
				{data.filter === chip.key
				? 'bg-brand-tint font-medium text-brand-strong'
				: 'text-muted hover:bg-neutral-tint hover:text-ink'}"
		>
			{chip.label}
			<span class="tnum ml-1 text-xs text-subtle">{chip.count}</span>
		</a>
	{/each}
</nav>

{#if data.disputes.length === 0}
	<Card class="mt-4">
		<p class="text-sm font-medium text-ink">Nothing here</p>
		<p class="mt-1 text-sm text-muted">
			{data.filter === 'live'
				? 'No disputes are waiting on a decision.'
				: 'No disputes match this filter.'}
		</p>
	</Card>
{:else}
	<ul class="mt-4 space-y-3">
		{#each data.disputes as dispute (dispute.id)}
			<li>
				<Card href="/admin/disputes/{dispute.id}">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<Badge variant={STATUS[dispute.status]?.variant ?? 'neutral'}>
									{STATUS[dispute.status]?.label ?? dispute.status}
								</Badge>
								<span class="text-sm font-medium text-ink">{dispute.buyerName}</span>
							</div>
							<!-- The reason is the whole reason this row exists, so it gets the
							     width. Clamped to two lines; the detail view has all of it. -->
							<p class="mt-2 line-clamp-2 text-sm text-muted">{dispute.reason}</p>
						</div>
						<div class="shrink-0 text-right">
							{#if dispute.amountCents !== null}
								<Price amount={centsToMajor(dispute.amountCents)} size="sm" />
							{/if}
							<p class="mt-1 text-xs text-subtle">{dateFmt.format(new Date(dispute.createdAt))}</p>
						</div>
					</div>
				</Card>
			</li>
		{/each}
	</ul>
{/if}
