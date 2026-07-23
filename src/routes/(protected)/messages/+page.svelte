<script lang="ts">
	import { Badge, Button } from '$lib/components/ui';
	import { PLACEHOLDER_IMAGE } from '$lib/listing-images';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const conversations = $derived(data.conversations);

	type Row = PageData['conversations'][number];
</script>

<svelte:head><title>Messages · MySoko</title></svelte:head>

{#snippet thumb(listing: Row['listing'])}
	{#if listing.type === 'service' && !listing.coverUrl}
		<!-- Photo-less service: the service glyph tile, not the generic image placeholder. -->
		<div
			class="flex h-14 w-14 flex-none items-center justify-center rounded-control border border-border bg-brand-tint text-brand-strong"
			aria-hidden="true"
		>
			<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none">
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
			src={listing.coverUrl ?? PLACEHOLDER_IMAGE}
			alt=""
			class="h-14 w-14 flex-none rounded-control border border-border object-cover"
		/>
	{/if}
{/snippet}

<main class="mx-auto max-w-3xl px-4 py-8 sm:py-10">
	<h1 class="font-display text-2xl font-bold text-ink">Messages</h1>
	<p class="mt-1 text-sm text-muted">Your conversations with buyers and sellers.</p>

	{#if conversations.length === 0}
		<div class="mt-6 rounded-card border border-border bg-surface p-10 text-center">
			<p class="text-sm text-muted">No messages yet — start a conversation from any listing.</p>
			<Button href="/" variant="secondary" class="mt-4">Browse listings</Button>
		</div>
	{:else}
		<!-- preload on tap, not hover: opening a thread marks it read, so we must not
		     fire that on a hover-preload (the global default is hover). -->
		<ul
			class="mt-6 divide-y divide-border overflow-hidden rounded-card border border-border bg-surface"
			data-sveltekit-preload-data="tap"
		>
			{#each conversations as c (c.id)}
				<li>
					<a
						href={`/messages/${c.id}`}
						class="flex gap-3 px-4 py-3.5 transition-colors hover:bg-page focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand focus-visible:outline-none"
					>
						{@render thumb(c.listing)}
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span
									class={`min-w-0 truncate text-ink ${c.unread ? 'font-semibold' : 'font-medium'}`}
								>
									{c.listing.title}
								</span>
								{#if c.listing.status !== 'active'}
									<Badge variant={c.listing.status} class="flex-none">
										<span class="capitalize">{c.listing.status}</span>
									</Badge>
								{/if}
								<span class="ml-auto flex flex-none items-center gap-1.5 text-xs text-subtle">
									{c.timeLabel}
									{#if c.unread}
										<span class="h-2 w-2 rounded-full bg-brand" aria-hidden="true"></span>
										<span class="sr-only">Unread</span>
									{/if}
								</span>
							</div>
							<p class="truncate text-xs text-subtle">{c.otherParty.full_name}</p>
							<p class={`truncate text-sm ${c.unread ? 'text-ink' : 'text-muted'}`}>
								{c.lastMessagePreview ?? 'No messages yet'}
							</p>
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</main>
