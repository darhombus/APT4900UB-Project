<script lang="ts">
	import { enhance } from '$app/forms';
	import { applyAction } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Button, Card } from '$lib/components/ui';
	import { notificationCount as notificationCountStore } from '$lib/notification-count.svelte';
	import type { NotificationIcon } from '$lib/notifications';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/**
	 * Tint by what the notification is ABOUT, not by type:
	 *   brand   — money moved (payment in, payout out)
	 *   neutral — an order moved through its lifecycle
	 *   accent  — attention on a listing's reputation or visibility
	 * Seven types, three tones, so the list is scannable before it is read.
	 */
	const TONES: Record<NotificationIcon, string> = {
		money: 'bg-brand-tint text-brand-strong',
		order: 'bg-neutral-tint text-neutral-strong',
		review: 'bg-accent-tint text-accent-strong',
		boost: 'bg-accent-tint text-accent-strong'
	};

	// Opening a notification is one fewer unread, so the badge should not wait for
	// the round trip. The server is still the authority — the redirect that
	// follows re-runs the layout load and overwrites this with the real count.
	const onOpen: SubmitFunction = ({ submitter }) => {
		if (submitter?.dataset.unread === 'true') {
			notificationCountStore.set(notificationCountStore.value - 1);
		}
		return async ({ result }) => {
			await applyAction(result);
		};
	};

	const onMarkAll: SubmitFunction = () => {
		notificationCountStore.set(0);
		return async ({ result }) => {
			// `success` makes applyAction re-run the load, so the rows restyle to read.
			await applyAction(result);
		};
	};
</script>

<svelte:head><title>Notifications · MySoko</title></svelte:head>

<main class="mx-auto max-w-3xl px-4 py-6 sm:py-8">
	<div class="flex items-center justify-between gap-4">
		<h1 class="font-display text-2xl font-bold text-ink">Notifications</h1>

		{#if data.unreadCount > 0}
			<form method="POST" action="?/markAllRead" use:enhance={onMarkAll}>
				<Button type="submit" variant="secondary" size="sm" data-testid="mark-all-read">
					Mark all as read
				</Button>
			</form>
		{/if}
	</div>

	{#if data.notifications.length === 0}
		<Card class="mt-6 p-8 text-center">
			<p class="text-sm text-muted">
				Nothing here yet. When an order, payout, review or boost needs your attention, it will show
				up on this page.
			</p>
			<div class="mt-4">
				<Button href="/">Browse listings</Button>
			</div>
		</Card>
	{:else}
		<!-- One form for the whole list: each row is its own submit button carrying
		     its id, so opening a notification marks it read and follows it to its
		     source in one POST. That keeps the page working before hydration and
		     with JavaScript off — the action computes the destination server-side
		     from the row itself, never from a form field. -->
		<form method="POST" action="?/markRead" use:enhance={onOpen}>
			<ul class="mt-6 space-y-2">
				{#each data.notifications as n (n.id)}
					<li>
						<button
							type="submit"
							name="id"
							value={n.id}
							data-testid="notification-item"
							data-unread={n.unread}
							class={`flex w-full items-start gap-3 rounded-card border border-l-2 bg-surface p-4 text-left transition-colors hover:bg-page focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none ${
								n.unread ? 'border-border border-l-brand' : 'border-border border-l-border'
							}`}
						>
							<span
								aria-hidden="true"
								class={`flex h-9 w-9 flex-none items-center justify-center rounded-control ${TONES[n.icon]}`}
							>
								<svg class="h-4.5 w-4.5" viewBox="0 0 20 20" fill="none">
									{#if n.icon === 'money'}
										<path
											d="M3 6.5h14v9H3z"
											stroke="currentColor"
											stroke-width="1.5"
											stroke-linejoin="round"
										/>
										<circle cx="10" cy="11" r="2.2" stroke="currentColor" stroke-width="1.5" />
									{:else if n.icon === 'order'}
										<path
											d="M4 7l6-3 6 3-6 3-6-3Zm0 0v6l6 3 6-3V7"
											stroke="currentColor"
											stroke-width="1.5"
											stroke-linejoin="round"
										/>
									{:else if n.icon === 'review'}
										<path
											d="m10 3.5 2 4.1 4.5.6-3.3 3.2.8 4.5L10 13.7l-4 2.2.8-4.5L3.5 8.2l4.5-.6 2-4.1Z"
											stroke="currentColor"
											stroke-width="1.5"
											stroke-linejoin="round"
										/>
									{:else}
										<path
											d="M10 3.5 12.5 9H16l-4 3 1.5 5.5L10 14l-3.5 3.5L8 12 4 9h3.5L10 3.5Z"
											stroke="currentColor"
											stroke-width="1.5"
											stroke-linejoin="round"
										/>
									{/if}
								</svg>
							</span>

							<span class="min-w-0 flex-1">
								<span class="flex items-baseline justify-between gap-3">
									<span
										class={`truncate text-sm ${n.unread ? 'font-semibold text-ink' : 'font-medium text-muted'}`}
									>
										{n.title}
									</span>
									<span class="flex-none text-xs text-subtle">{n.age}</span>
								</span>
								<span class="mt-1 block text-sm leading-relaxed text-muted">{n.body}</span>
							</span>
						</button>
					</li>
				{/each}
			</ul>
		</form>
	{/if}
</main>
