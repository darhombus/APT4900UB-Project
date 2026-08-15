<script lang="ts">
	import { Badge, Card } from '$lib/components/ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/**
	 * Plain-language labels. The stored action_type is a machine value; an audit
	 * log is read by people, and "Took a listing down" is what happened.
	 */
	const LABELS: Record<string, string> = {
		dispute_review: 'Started reviewing a dispute',
		dispute_resolve_refunded: 'Resolved a dispute — refunded',
		dispute_resolve_rejected: 'Resolved a dispute — rejected',
		listing_takedown: 'Took a listing down',
		listing_restore: 'Restored a listing',
		review_hide: 'Hid a review',
		review_restore: 'Restored a review',
		boost_terminate: 'Ended a boost',
		pii_read: 'Viewed private details'
	};

	// pii_read is the one entry that records a LOOK rather than a change, so it
	// is the one an audit reader scans for. Tinted accordingly — attention, not
	// alarm.
	const variantFor = (t: string) => (t === 'pii_read' ? 'accent' : 'neutral');

	const hrefFor = (a: { targetTable: string; targetId: string }) =>
		a.targetTable === 'disputes'
			? `/admin/disputes/${a.targetId}`
			: a.targetTable === 'listings'
				? `/listings/${a.targetId}`
				: a.targetTable === 'profiles_private'
					? `/admin/users/${a.targetId}`
					: null;

	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' });

	const detailPairs = (detail: unknown) =>
		detail && typeof detail === 'object'
			? Object.entries(detail as Record<string, unknown>).filter(([, v]) => v !== null && v !== '')
			: [];
</script>

<svelte:head><title>Audit log · Admin · MySoko</title></svelte:head>

<nav aria-label="Filter by action" class="flex flex-wrap gap-1">
	<a
		href="/admin/actions"
		aria-current={data.type === 'all' ? 'true' : undefined}
		class="rounded-pill px-3 py-1 text-sm transition-colors
			{data.type === 'all'
			? 'bg-brand-tint font-medium text-brand-strong'
			: 'text-muted hover:bg-neutral-tint hover:text-ink'}"
	>
		All
	</a>
	{#each data.types as t (t)}
		<a
			href="/admin/actions?type={t}"
			aria-current={data.type === t ? 'true' : undefined}
			class="rounded-pill px-3 py-1 text-sm transition-colors
				{data.type === t
				? 'bg-brand-tint font-medium text-brand-strong'
				: 'text-muted hover:bg-neutral-tint hover:text-ink'}"
		>
			{LABELS[t] ?? t}
		</a>
	{/each}
</nav>

{#if data.actions.length === 0}
	<Card class="mt-4">
		<p class="text-sm font-medium text-ink">Nothing logged</p>
		<p class="mt-1 text-sm text-muted">Admin actions appear here as they happen.</p>
	</Card>
{:else}
	<ul class="mt-4 space-y-2">
		{#each data.actions as action (action.id)}
			<li>
				<Card>
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<Badge variant={variantFor(action.actionType)}>
									{LABELS[action.actionType] ?? action.actionType}
								</Badge>
								<span class="text-sm text-muted">{action.actorName}</span>
							</div>

							{#if detailPairs(action.detail).length > 0}
								<dl class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
									{#each detailPairs(action.detail) as [key, value] (key)}
										<div class="flex gap-1">
											<dt>{key.replace(/_/g, ' ')}</dt>
											<dd class="text-muted">{String(value)}</dd>
										</div>
									{/each}
								</dl>
							{/if}

							{#if hrefFor(action)}
								<a
									href={hrefFor(action)}
									class="mt-2 inline-block text-xs text-muted hover:text-brand"
								>
									Open {action.targetTable.replace(/_/g, ' ')} →
								</a>
							{/if}
						</div>

						<p class="shrink-0 text-xs text-subtle">
							{dateFmt.format(new Date(action.createdAt))}
						</p>
					</div>
				</Card>
			</li>
		{/each}
	</ul>
{/if}
