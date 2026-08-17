<script lang="ts">
	import { Badge, Card } from '$lib/components/ui';
	import { messageDay, messageTime } from '$lib/relative-time';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/**
	 * A TRANSCRIPT, NOT A CHAT. The participant thread renders bubbles aligned
	 * left and right, which encodes "mine vs theirs" — a distinction that means
	 * nothing to a third party reading it. An admin deciding a dispute is asking
	 * "who said what, and when", so every message gets the same alignment and a
	 * labelled speaker column that can be scanned straight down.
	 */
	const speaker = (senderId: string) =>
		senderId === data.buyer.id
			? { name: data.buyer.name, role: 'Buyer' as const }
			: { name: data.seller.name, role: 'Seller' as const };

	// Date separators only where the day actually changes.
	const dayFor = (iso: string) => messageDay(iso);
</script>

<svelte:head><title>Dispute messages · Admin</title></svelte:head>

<div class="mx-auto max-w-3xl">
	<a
		href="/admin/disputes/{data.disputeId}"
		class="text-sm text-subtle transition-colors hover:text-ink">← Back to the dispute</a
	>

	<h2 class="mt-3 font-display text-lg font-semibold text-ink">Messages</h2>
	<p class="mt-1 text-sm text-muted">
		{data.buyer.name} and {data.seller.name} on “{data.listingTitle}”.
	</p>
	<!-- Says plainly that nothing here writes back, so an admin knows opening this
	     page does not touch the participants' unread state. -->
	<p class="mt-1 text-xs text-subtle">
		Read-only. Opening this page does not mark anything as read.
	</p>

	{#if data.messages.length === 0}
		<Card class="mt-6 text-center">
			<p class="py-6 text-sm text-muted">This thread exists but nobody has sent a message in it.</p>
		</Card>
	{:else}
		<Card class="mt-6">
			<ol class="divide-y divide-border">
				{#each data.messages as message, i (message.id)}
					{@const who = speaker(message.sender_id)}
					{@const day = dayFor(message.created_at)}
					{@const newDay = i === 0 || day !== dayFor(data.messages[i - 1].created_at)}

					{#if newDay}
						<li class="pt-4 pb-2 first:pt-0">
							<p class="text-xs font-semibold tracking-wide text-subtle uppercase">{day}</p>
						</li>
					{/if}

					<li class="flex gap-3 py-3">
						<div class="flex w-28 flex-none flex-col gap-1">
							<Badge variant={who.role === 'Buyer' ? 'brand' : 'neutral'}>{who.role}</Badge>
							<span class="truncate text-xs text-subtle" title={who.name}>{who.name}</span>
						</div>
						<div class="min-w-0 flex-1">
							<p class="text-sm whitespace-pre-wrap text-ink">{message.body}</p>
							<p class="mt-1 text-xs text-subtle">{messageTime(message.created_at)}</p>
						</div>
					</li>
				{/each}
			</ol>
		</Card>
	{/if}
</div>
