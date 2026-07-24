<script lang="ts">
	import { enhance } from '$app/forms';
	import { Badge, Button, Price } from '$lib/components/ui';
	import { PLACEHOLDER_IMAGE } from '$lib/listing-images';
	import { messageTime, messageDay } from '$lib/relative-time';
	import { notifyFromResult } from '$lib/toast.svelte';
	import { unreadCount } from '$lib/unread-count.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Msg = { id: string; sender_id: string; body: string; created_at: string };

	const listing = $derived(data.conversation.listing);
	const other = $derived(data.conversation.otherParty);
	// Stable id + token (strings) so the Realtime effect below only re-subscribes on a
	// real change — NOT when a layout invalidation (the live badge) swaps data.session's
	// reference, which would tear down the channel and drop an in-flight message.
	const conversationId = $derived(data.conversation.id);
	const accessToken = $derived(data.session?.access_token ?? null);

	// D3: send while active/paused/sold; blocked when deleted/removed. The context
	// card only links out when the listing is publicly reachable (active/sold) —
	// otherwise the link would 404 for the buyer.
	const canSend = $derived(
		listing.status === 'active' || listing.status === 'paused' || listing.status === 'sold'
	);
	const listingHref = $derived(
		listing.status === 'active' || listing.status === 'sold' ? `/listings/${listing.id}` : null
	);

	// Messages that arrived live (Realtime) after the server load. `messages` dedups
	// them against the server data; the reset effect drops the buffer whenever a
	// fresh load (e.g. after sending) supersedes it.
	let live = $state<Msg[]>([]);
	const serverIds = $derived(new Set(data.messages.map((m) => m.id)));
	const messages = $derived([...data.messages, ...live.filter((m) => !serverIds.has(m.id))]);

	// A signature of the server message set. It changes only on a REAL reload (new
	// messages) — not when an unrelated layout invalidation (the app-wide unread badge)
	// hands `data` a new reference with the same messages. Keying the reset on this is
	// critical: otherwise the badge refresh wipes a message that just arrived over
	// Realtime before it can be rendered.
	const serverKey = $derived(data.messages.map((m) => m.id).join(','));
	$effect(() => {
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		serverKey; // track the signature; reset the live buffer only when it truly changes
		live = [];
	});

	// Group consecutive messages from the same sender: the time shows only on the
	// last bubble of a group, and a day divider precedes each new day. Pure and
	// deterministic (fixed-EAT formatting), so SSR and hydration agree.
	const items = $derived(
		messages.map((m, i) => {
			const prev = messages[i - 1];
			const next = messages[i + 1];
			const day = messageDay(m.created_at);
			const divider = !prev || messageDay(prev.created_at) !== day ? day : null;
			const lastOfGroup =
				!next || next.sender_id !== m.sender_id || messageDay(next.created_at) !== day;
			return {
				id: m.id,
				body: m.body,
				mine: m.sender_id === data.me,
				time: messageTime(m.created_at),
				showTime: lastOfGroup,
				divider
			};
		})
	);

	function initials(name: string): string {
		return (
			name
				.split(/\s+/)
				.filter(Boolean)
				.slice(0, 2)
				.map((w) => w[0]!.toUpperCase())
				.join('') || '?'
		);
	}

	// ── Composer ────────────────────────────────────────────────────────────────
	let composer = $state('');
	let sending = $state(false); // drives the Send spinner — DELAYED, so a fast send feels instant
	let inFlight = false; // immediate double-submit guard (non-visual)
	let realtimeReady = $state(false); // true once the thread's Realtime channel is subscribed
	const onSend: SubmitFunction = ({ cancel }) => {
		if (inFlight) return cancel(); // ignore a second submit while one is in flight
		inFlight = true;
		// Only show the spinner if the round-trip is actually slow. A fast send shouldn't
		// flash a loading state — the message itself appears live via the subscription.
		const spinnerTimer = setTimeout(() => {
			if (inFlight) sending = true;
		}, 400);
		return async ({ result, update }) => {
			clearTimeout(spinnerTimer);
			inFlight = false;
			sending = false;
			if (result.type === 'redirect') {
				// Success. Clear the box; the sent message lands via the Realtime
				// subscription. Skip the redirect-RELOAD — that reload is what made sending
				// feel slow — whenever the channel is live; fall back to it only when
				// Realtime isn't connected (cold start / down) so the sender still sees it.
				composer = '';
				if (realtimeReady) return;
				await update();
				return;
			}
			// failure (validation) or error (network) → toast, keep the composer text.
			notifyFromResult(result);
		};
	};

	// Enter sends; Shift+Enter (and mid-IME-composition Enter) inserts a newline.
	function onComposerKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
		event.preventDefault();
		if (inFlight) return; // don't double-send while one is in flight
		(event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
	}

	// ── Scroll to the newest message ─────────────────────────────────────────────
	let scrollEl = $state<HTMLElement | null>(null);
	$effect(() => {
		const count = items.length; // read to re-run whenever a message is added
		if (scrollEl && count >= 0) scrollEl.scrollTop = scrollEl.scrollHeight;
	});

	// ── Live unread (read → decrement) ───────────────────────────────────────────
	// The server load marked this thread read; refresh the header badge count via
	// the lightweight endpoint (not a layout reload). Keyed on the id → runs once
	// per thread opened.
	function refreshUnreadCount() {
		fetch('/api/unread-count')
			.then((r) => r.json())
			.then(({ count }) => unreadCount.set(count))
			.catch(() => {});
	}
	$effect(() => {
		if (conversationId) refreshUnreadCount();
	});

	// ── Realtime (progressive enhancement per D4) ────────────────────────────────
	// Best-effort: mark the thread read when a live message from the counterpart
	// arrives, via the markRead action (which knows which last-read column is ours).
	function markReadRemote() {
		fetch(`/messages/${data.conversation.id}?/markRead`, {
			method: 'POST',
			body: new FormData(),
			headers: { 'x-sveltekit-action': 'true' }
		})
			.then(refreshUnreadCount) // a live message we just read → keep the badge honest
			.catch(() => {});
	}

	$effect(() => {
		const convId = conversationId;
		const token = accessToken;
		const supabase = data.supabase;
		realtimeReady = false; // re-establishing on this conversation; not live until SUBSCRIBED
		// Authenticate the socket so postgres_changes is evaluated under the user's RLS.
		void supabase.realtime.setAuth(token);

		const channel = supabase
			.channel(`thread:${convId}`)
			.on(
				'postgres_changes',
				{
					event: 'INSERT',
					schema: 'public',
					table: 'messages',
					filter: `conversation_id=eq.${convId}`
				},
				(payload) => {
					const m = payload.new as Msg;
					if (serverIds.has(m.id) || live.some((x) => x.id === m.id)) return; // dedup
					live = [
						...live,
						{ id: m.id, sender_id: m.sender_id, body: m.body, created_at: m.created_at }
					];
					if (m.sender_id !== data.me) markReadRemote();
				}
			)
			.subscribe((status) => {
				realtimeReady = status === 'SUBSCRIBED';
				// If the channel never connects, the thread still works (history + form).
				if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
					console.warn(`[thread] realtime ${status.toLowerCase()} — live updates disabled`);
				}
			});

		return () => {
			supabase.removeChannel(channel);
		};
	});
</script>

<svelte:head><title>{other.full_name} · Messages · MySoko</title></svelte:head>

<main class="mx-auto flex max-w-2xl flex-col px-4 py-6 sm:py-8">
	<!-- Header: back to the list + the counterpart -->
	<div class="flex items-center gap-2.5">
		<a
			href="/messages"
			aria-label="Back to messages"
			class="flex h-9 w-9 flex-none items-center justify-center rounded-control text-muted transition-colors hover:bg-page hover:text-ink focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
		>
			<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
				<path
					d="M15 6l-6 6 6 6"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</a>
		{#if other.avatar_url}
			<img src={other.avatar_url} alt="" class="h-9 w-9 flex-none rounded-pill object-cover" />
		{:else}
			<span
				class="flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-brand-tint text-xs font-semibold text-brand-strong"
			>
				{initials(other.full_name)}
			</span>
		{/if}
		<h1 class="min-w-0 truncate font-display text-lg font-bold text-ink">{other.full_name}</h1>
	</div>

	<!-- Listing context card -->
	{#snippet context()}
		<div class="flex items-center gap-3">
			{#if listing.type === 'service' && !listing.coverUrl}
				<div
					class="flex h-12 w-12 flex-none items-center justify-center rounded-control border border-border bg-brand-tint text-brand-strong"
					aria-hidden="true"
				>
					<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none">
						<rect
							x="3"
							y="7"
							width="18"
							height="13"
							rx="2"
							stroke="currentColor"
							stroke-width="1.7"
						/>
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
					class="h-12 w-12 flex-none rounded-control border border-border object-cover"
				/>
			{/if}
			<div class="min-w-0 flex-1">
				<p class="truncate font-medium text-ink">{listing.title}</p>
				<div class="mt-0.5 flex items-center gap-2">
					<Price amount={listing.price} size="sm" />
					{#if listing.status !== 'active'}
						<Badge variant={listing.status}><span class="capitalize">{listing.status}</span></Badge>
					{/if}
				</div>
			</div>
		</div>
	{/snippet}

	{#if listingHref}
		<a
			href={listingHref}
			class="mt-3 block rounded-card border border-border bg-surface p-3 transition-colors hover:border-subtle/40"
		>
			{@render context()}
		</a>
	{:else}
		<div class="mt-3 rounded-card border border-border bg-surface p-3">
			{@render context()}
		</div>
	{/if}
	{#if listing.status === 'sold'}
		<p class="mt-1.5 text-xs text-subtle">
			This item is sold — you can still message about pickup.
		</p>
	{/if}

	<!-- History -->
	<div
		bind:this={scrollEl}
		class="mt-4 max-h-[58vh] min-h-60 space-y-1 overflow-y-auto rounded-card border border-border bg-page p-4"
	>
		{#if items.length === 0}
			<p class="py-10 text-center text-sm text-subtle">No messages yet — say hello.</p>
		{:else}
			{#each items as m (m.id)}
				{#if m.divider}
					<div class="flex items-center justify-center py-2">
						<span
							class="rounded-pill bg-neutral-tint px-2.5 py-0.5 text-xs font-medium text-neutral-strong"
						>
							{m.divider}
						</span>
					</div>
				{/if}
				<div class={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
					<div class="max-w-[80%]">
						<div
							class={`rounded-card px-3.5 py-2 text-sm whitespace-pre-wrap wrap-break-word ${
								m.mine ? 'bg-brand text-white' : 'border border-border bg-surface text-ink'
							}`}
						>
							{m.body}
						</div>
						{#if m.showTime}
							<p class={`mt-0.5 text-xs text-subtle ${m.mine ? 'text-right' : 'text-left'}`}>
								{m.time}
							</p>
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	</div>

	<!-- Composer, or the blocked notice (D3) -->
	{#if canSend}
		<form method="POST" action="?/send" use:enhance={onSend} class="mt-3 flex items-end gap-2">
			<textarea
				name="body"
				bind:value={composer}
				onkeydown={onComposerKeydown}
				rows="1"
				required
				placeholder="Write a message"
				class="min-h-11 flex-1 resize-none rounded-control border border-border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-subtle focus:border-brand focus:ring-2 focus:ring-brand/30 focus:outline-none"
			></textarea>
			<Button type="submit" loading={sending}>Send</Button>
		</form>
	{:else}
		<div
			class="mt-3 rounded-card border border-border bg-neutral-tint/50 px-4 py-3 text-center text-sm text-muted"
		>
			This listing is no longer available, so you can’t send new messages. The conversation stays
			here for reference.
		</div>
	{/if}
</main>
