<script lang="ts">
	import { page } from '$app/state';
	import { Alert, Button, Card, Price } from '$lib/components/ui';
	import { PLACEHOLDER_IMAGE } from '$lib/listing-images';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Money is stored as integer cents (D8); Price takes major units.
	const amount = $derived(data.order.amountTotal / 100);

	// A declined charge leaves the order pending_payment and still resumable (D5
	// has no failed order status), so it needs different copy — and a way back in
	// — from a checkout that is genuinely over.
	const declined = $derived(data.order.status === 'pending_payment');

	const failedHeading = $derived(
		declined ? 'Payment didn’t go through' : 'This checkout is closed'
	);

	const heading = $derived(
		data.state === 'success'
			? 'Payment received'
			: data.state === 'pending'
				? 'Confirming your payment…'
				: failedHeading
	);

	const failedDetail = $derived(
		declined
			? 'Nothing was charged. You can try again while this checkout is still open.'
			: data.order.status === 'expired'
				? 'The 30-minute checkout window passed before payment came through.'
				: 'This checkout was cancelled, so nothing was charged.'
	);

	// "Check again" re-requests this same URL — the load re-verifies. Built from
	// the current URL so the reference survives the round trip.
	const recheckHref = $derived(page.url.pathname + page.url.search);
</script>

<svelte:head>
	<title>{heading} · MySoko</title>
	<meta name="robots" content="noindex" />
	{#if data.state === 'pending'}
		<!-- No-JS re-check (D2). A meta refresh keeps the page honest without a
		     client-side polling loop; the load does the work on each request. -->
		<meta http-equiv="refresh" content="5" />
	{/if}
</svelte:head>

<main class="mx-auto max-w-lg px-4 py-8 sm:py-12">
	<Card class="p-6">
		{#if data.state === 'success'}
			<div class="flex items-center gap-3">
				<span
					class="flex h-10 w-10 flex-none items-center justify-center rounded-pill bg-success-tint text-success-strong"
					aria-hidden="true"
				>
					<svg class="h-5 w-5" viewBox="0 0 20 20" fill="none">
						<path
							d="M5 10.5l3.5 3.5L15 7"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</span>
				<div>
					<h1 class="font-display text-xl font-bold text-ink">{heading}</h1>
					<p class="text-sm text-muted">Your order is confirmed.</p>
				</div>
			</div>
		{:else if data.state === 'pending'}
			<h1 class="font-display text-xl font-bold text-ink">{heading}</h1>
			<p class="mt-1 text-sm text-muted">
				This page checks again every few seconds. You can safely leave it open.
			</p>
		{:else}
			<h1 class="font-display text-xl font-bold text-ink">{heading}</h1>
			<p class="mt-1 text-sm text-muted">{failedDetail}</p>
		{/if}

		<!-- Order summary -->
		<div class="mt-6 flex gap-4 border-t border-border pt-6">
			<img
				src={data.listing.coverUrl ?? PLACEHOLDER_IMAGE}
				alt=""
				class="h-16 w-16 flex-none rounded-control border border-border object-cover"
			/>
			<div class="min-w-0 flex-1">
				<p class="truncate font-medium text-ink">{data.listing.title}</p>
				<div class="mt-1"><Price showCents {amount} /></div>
			</div>
		</div>

		<dl class="mt-4 space-y-1 text-sm">
			<div class="flex justify-between gap-4">
				<dt class="text-muted">Reference</dt>
				<dd class="truncate font-mono text-xs text-ink">{data.order.reference}</dd>
			</div>
		</dl>

		<div class="mt-6 flex flex-col gap-2">
			{#if data.state === 'success'}
				<Button href={`/account/orders/${data.order.id}`} class="w-full">View order</Button>
				<Button href="/" variant="secondary" class="w-full">Keep browsing</Button>
			{:else if data.state === 'pending'}
				<Button href={recheckHref} class="w-full">Check again</Button>
				<Button href={`/listings/${data.listing.id}`} variant="secondary" class="w-full">
					Back to the listing
				</Button>
			{:else if declined && data.order.authorizationUrl}
				<Button href={data.order.authorizationUrl} class="w-full">Try payment again</Button>
				<Button href={`/listings/${data.listing.id}`} variant="secondary" class="w-full">
					Back to the listing
				</Button>
			{:else}
				<Button href={`/listings/${data.listing.id}`} class="w-full">Back to the listing</Button>
			{/if}
		</div>
	</Card>

	{#if data.state === 'pending'}
		<Alert variant="info" class="mt-4">
			If you completed payment, it can take a moment to reach us. Nothing is charged twice — this
			page and our payment provider both settle to the same order.
		</Alert>
	{/if}
</main>
