<script lang="ts">
	import { enhance } from '$app/forms';
	import { navigating } from '$app/state';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Badge, Button, Card, Price } from '$lib/components/ui';
	import { toast } from '$lib/toast.svelte';
	import type { Database } from '$lib/types/database';
	import type { PageData } from './$types';

	type ListingStatus = Database['public']['Enums']['listing_status'];

	let { data }: { data: PageData } = $props();

	const tabs = $derived([
		{ key: 'all', label: 'All', count: data.counts.all },
		{ key: 'draft', label: 'Draft', count: data.counts.draft },
		{ key: 'active', label: 'Active', count: data.counts.active },
		{ key: 'paused', label: 'Paused', count: data.counts.paused },
		{ key: 'sold', label: 'Sold', count: data.counts.sold }
	] as const);

	const TAB_KEYS = ['all', 'draft', 'active', 'paused', 'sold'] as const;
	type Tab = (typeof TAB_KEYS)[number];

	function tabFromUrl(url: URL): Tab {
		const p = url.searchParams.get('tab');
		return (TAB_KEYS as readonly string[]).includes(p ?? '') ? (p as Tab) : 'all';
	}

	// Flip the active tab at CLICK time, not after data arrives: while a navigation to
	// this page is in flight, reflect its target tab; otherwise the loaded tab. The
	// list area shows a skeleton for that same window.
	const navToListings = $derived(
		navigating.to?.url.pathname === '/sell/listings' ? navigating.to.url : null
	);
	const activeTab = $derived(navToListings ? tabFromUrl(navToListings) : data.tab);
	const tabLoading = $derived(navToListings !== null);

	const SKELETON_ROWS = [0, 1, 2, 3];

	const dateFmt = new Intl.DateTimeFormat('en-KE', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
	const fmtDate = (iso: string) => dateFmt.format(new Date(iso));

	// One-at-a-time submit tracking, plus a confirm gate on the destructive delete.
	let pending = $state<string | null>(null);
	const isPending = (id: string, t: string) => pending === `${id}:${t}`;

	const DELETABLE: readonly ListingStatus[] = ['draft', 'active', 'paused', 'sold'];

	function act(
		transition: string,
		id: string,
		listing?: (typeof data.listings)[number]
	): SubmitFunction {
		return ({ cancel }) => {
			if (transition === 'delete') {
				const name = listing?.title ? `“${listing.title}”` : 'this listing';
				const message =
					listing?.status === 'draft'
						? `Delete ${name}? This removes the draft and its photos for good — it can’t be undone.`
						: `Delete ${name}? It will be removed from the marketplace for good — this can’t be undone.`;
				if (!confirm(message)) {
					cancel();
					return;
				}
			}
			pending = `${id}:${transition}`;
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') {
					const message = (result.data as { message?: string } | undefined)?.message;
					if (message) toast.success(message);
				} else if (result.type === 'failure') {
					const message = (result.data as { transitionError?: string } | undefined)
						?.transitionError;
					if (message) toast.error(message);
				}
				pending = null;
			};
		};
	}
</script>

<svelte:head><title>Your listings · MySoko</title></svelte:head>

{#snippet statusBadge(status: ListingStatus)}
	<Badge variant={status}><span class="capitalize">{status}</span></Badge>
{/snippet}

{#snippet thumb(l: (typeof data.listings)[number], size: string)}
	{#if l.isService && !l.hasImage}
		<!-- Photo-less service: a service glyph tile, never the placeholder-image icon. -->
		<div
			class={`${size} flex flex-none items-center justify-center rounded-control border border-border bg-brand-tint text-brand-strong`}
			aria-hidden="true"
		>
			<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none">
				<rect x="3" y="7" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.7" />
				<path
					d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7"
					stroke="currentColor"
					stroke-width="1.7"
				/>
				<path d="M3 12h18" stroke="currentColor" stroke-width="1.7" />
			</svg>
		</div>
	{:else}
		<img
			src={l.coverUrl}
			alt=""
			class={`${size} flex-none rounded-control border border-border object-cover`}
		/>
	{/if}
{/snippet}

{#snippet rowActions(l: (typeof data.listings)[number])}
	{#if l.status === 'draft'}
		<form method="POST" action="?/publish" use:enhance={act('publish', l.id)}>
			<input type="hidden" name="id" value={l.id} />
			<Button type="submit" size="sm" loading={isPending(l.id, 'publish')} disabled={!!pending}>
				Publish
			</Button>
		</form>
		<Button href={`/sell/listings/${l.id}/edit`} size="sm" variant="secondary">Edit</Button>
	{:else if l.status === 'active'}
		<form method="POST" action="?/markSold" use:enhance={act('markSold', l.id)}>
			<input type="hidden" name="id" value={l.id} />
			<Button
				type="submit"
				size="sm"
				variant="secondary"
				loading={isPending(l.id, 'markSold')}
				disabled={!!pending}
			>
				Mark as sold
			</Button>
		</form>
		<form method="POST" action="?/unpublish" use:enhance={act('unpublish', l.id)}>
			<input type="hidden" name="id" value={l.id} />
			<Button
				type="submit"
				size="sm"
				variant="ghost"
				loading={isPending(l.id, 'unpublish')}
				disabled={!!pending}
			>
				Unpublish
			</Button>
		</form>
		<Button href={`/sell/listings/${l.id}/edit`} size="sm" variant="secondary">Edit</Button>
	{:else if l.status === 'paused'}
		<form method="POST" action="?/republish" use:enhance={act('republish', l.id)}>
			<input type="hidden" name="id" value={l.id} />
			<Button type="submit" size="sm" loading={isPending(l.id, 'republish')} disabled={!!pending}>
				Republish
			</Button>
		</form>
		<form method="POST" action="?/markSold" use:enhance={act('markSold', l.id)}>
			<input type="hidden" name="id" value={l.id} />
			<Button
				type="submit"
				size="sm"
				variant="secondary"
				loading={isPending(l.id, 'markSold')}
				disabled={!!pending}
			>
				Mark as sold
			</Button>
		</form>
		<Button href={`/sell/listings/${l.id}/edit`} size="sm" variant="secondary">Edit</Button>
	{:else if l.status === 'sold'}
		<form method="POST" action="?/relist" use:enhance={act('relist', l.id)}>
			<input type="hidden" name="id" value={l.id} />
			<Button type="submit" size="sm" loading={isPending(l.id, 'relist')} disabled={!!pending}>
				Relist
			</Button>
		</form>
		<Button href={`/sell/listings/${l.id}/edit`} size="sm" variant="secondary">Edit</Button>
	{:else}
		<span class="text-sm text-subtle">—</span>
	{/if}
	{#if DELETABLE.includes(l.status)}
		<form method="POST" action="?/delete" use:enhance={act('delete', l.id, l)}>
			<input type="hidden" name="id" value={l.id} />
			<Button
				type="submit"
				size="icon"
				variant="destructive"
				loading={isPending(l.id, 'delete')}
				disabled={!!pending}
				aria-label="Delete"
				title="Delete"
			>
				{#if !isPending(l.id, 'delete')}
					<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path d="M4 7h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
						<path
							d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"
							stroke="currentColor"
							stroke-width="1.7"
						/>
						<path
							d="M6 7l1 12a2 2 0 0 0 2 1.9h6a2 2 0 0 0 2-1.9L18 7"
							stroke="currentColor"
							stroke-width="1.7"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
						<path
							d="M10 11v6M14 11v6"
							stroke="currentColor"
							stroke-width="1.7"
							stroke-linecap="round"
						/>
					</svg>
				{/if}
			</Button>
		</form>
	{/if}
{/snippet}

<main class="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:py-10">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="font-display text-2xl font-bold text-ink">Your listings</h1>
			<p class="mt-1 text-sm text-muted">Publish, update, and track what you’re selling.</p>
		</div>
		<Button href="/sell/listings/new">+ New listing</Button>
	</div>

	{#if data.counts.all === 0}
		<Card class="text-center">
			<div class="mx-auto max-w-sm py-8">
				<h2 class="font-display text-lg font-semibold text-ink">Nothing listed yet</h2>
				<p class="mt-1 text-sm text-muted">
					Post your first item or service — it only takes a couple of minutes.
				</p>
				<Button href="/sell/listings/new" class="mt-4">Create your first listing</Button>
			</div>
		</Card>
	{:else}
		<!-- Filter tabs: real ?tab= links, preloaded on hover/touch so the common case is
		     instant, with the active state flipping at click time (see activeTab). -->
		<div class="flex flex-wrap gap-1 border-b border-border" data-sveltekit-preload-data="hover">
			{#each tabs as t (t.key)}
				<a
					href={t.key === 'all' ? '/sell/listings' : `?tab=${t.key}`}
					aria-current={activeTab === t.key ? 'page' : undefined}
					class={`-mb-px flex items-center gap-1.5 rounded-t-control border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
						activeTab === t.key
							? 'border-brand text-ink'
							: 'border-transparent text-muted hover:text-ink'
					}`}
				>
					{t.label}
					<span class="rounded-pill bg-neutral-tint px-1.5 py-0.5 text-xs text-neutral-strong">
						{t.count}
					</span>
				</a>
			{/each}
		</div>

		{#if tabLoading}
			<!-- Lightweight loading state (design-foundation tokens) while the tab loads. -->
			<div class="overflow-hidden rounded-card border border-border bg-surface" aria-hidden="true">
				<div class="animate-pulse divide-y divide-border">
					{#each SKELETON_ROWS as i (i)}
						<div class="flex items-center gap-3 px-4 py-3">
							<div class="h-12 w-12 flex-none rounded-control bg-neutral-tint"></div>
							<div class="min-w-0 flex-1 space-y-2">
								<div class="h-3.5 w-1/2 rounded bg-neutral-tint"></div>
								<div class="h-3 w-1/4 rounded bg-neutral-tint"></div>
							</div>
							<div class="hidden h-8 w-24 flex-none rounded-control bg-neutral-tint sm:block"></div>
						</div>
					{/each}
				</div>
			</div>
			<span class="sr-only" role="status">Loading listings…</span>
		{:else if data.listings.length === 0}
			<Card class="text-center">
				<p class="py-6 text-sm text-muted">No {data.tab} listings.</p>
			</Card>
		{:else}
			<!-- Desktop table -->
			<div class="hidden overflow-hidden rounded-card border border-border bg-surface sm:block">
				<table class="w-full text-sm">
					<thead>
						<tr
							class="border-b border-border text-left text-xs tracking-wide text-subtle uppercase"
						>
							<th class="px-4 py-3 font-medium">Listing</th>
							<th class="px-4 py-3 text-right font-medium">Price</th>
							<th class="px-4 py-3 font-medium">Status</th>
							<th class="px-4 py-3 font-medium">Created</th>
							<th class="px-4 py-3 text-right font-medium">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each data.listings as l (l.id)}
							<tr class="border-b border-border align-middle last:border-0">
								<td class="px-4 py-3">
									<div class="flex items-center gap-3">
										{@render thumb(l, 'h-12 w-12')}
										<div class="min-w-0">
											<a
												href={`/sell/listings/${l.id}/edit`}
												class="block truncate font-medium text-ink hover:text-brand"
											>
												{l.title}
											</a>
											{#if l.location_area}
												<span class="text-xs text-subtle">{l.location_area}</span>
											{/if}
										</div>
									</div>
								</td>
								<td class="px-4 py-3 text-right"><Price amount={l.price} /></td>
								<td class="px-4 py-3">{@render statusBadge(l.status)}</td>
								<td class="px-4 py-3 whitespace-nowrap text-subtle">{fmtDate(l.created_at)}</td>
								<td class="px-4 py-3">
									<div class="flex flex-wrap justify-end gap-2">{@render rowActions(l)}</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Mobile cards -->
			<div class="space-y-3 sm:hidden">
				{#each data.listings as l (l.id)}
					<Card>
						<div class="flex gap-3">
							{@render thumb(l, 'h-16 w-16')}
							<div class="min-w-0 flex-1">
								<div class="flex items-start justify-between gap-2">
									<a href={`/sell/listings/${l.id}/edit`} class="truncate font-medium text-ink">
										{l.title}
									</a>
									{@render statusBadge(l.status)}
								</div>
								<div class="mt-0.5"><Price amount={l.price} /></div>
								<p class="mt-0.5 text-xs text-subtle">
									{fmtDate(l.created_at)}{l.location_area ? ` · ${l.location_area}` : ''}
								</p>
							</div>
						</div>
						<div class="mt-3 flex flex-wrap gap-2">{@render rowActions(l)}</div>
					</Card>
				{/each}
			</div>
		{/if}
	{/if}
</main>
