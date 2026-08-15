<script lang="ts">
	import { Card } from '$lib/components/ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/**
	 * Queue depths, ordered by who is waiting. A dispute has a buyer and a seller
	 * both waiting on a person; a taken-down listing has a seller waiting; hidden
	 * reviews and live boosts are standing state, not a queue. The audit log is
	 * last because it is a record, not work.
	 *
	 * `attention` marks the two counts that mean someone is blocked. It is not a
	 * severity scale — a count is either work waiting or it is not.
	 */
	const queues = $derived([
		{
			href: '/admin/disputes',
			label: 'Open disputes',
			count: data.openDisputes,
			hint: 'Buyers waiting on a decision',
			attention: data.openDisputes > 0
		},
		{
			href: '/admin/listings',
			label: 'Taken down',
			count: data.removedListings,
			hint: 'Listings removed by moderation',
			attention: false
		},
		{
			href: '/admin/reviews',
			label: 'Hidden reviews',
			count: data.hiddenReviews,
			hint: 'Removed from public view',
			attention: false
		},
		{
			href: '/admin/boosts',
			label: 'Live boosts',
			count: data.activeBoosts,
			hint: 'Paid placements running now',
			attention: false
		},
		{
			href: '/admin/actions',
			label: 'Logged actions',
			count: data.recentActions,
			hint: 'Every admin mutation, newest first',
			attention: false
		}
	]);
</script>

<svelte:head><title>Admin · MySoko</title></svelte:head>

<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
	{#each queues as q (q.href)}
		<Card href={q.href} class="group">
			<p class="text-sm font-medium text-muted">{q.label}</p>
			<p
				class="tnum mt-2 font-display text-3xl font-semibold tracking-tight
					{q.attention ? 'text-brand' : 'text-ink'}"
			>
				{q.count}
			</p>
			<p class="mt-1 text-xs text-subtle">{q.hint}</p>
		</Card>
	{/each}
</div>
