<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { Alert, Badge, Button, Price } from '$lib/components/ui';
	import { PLACEHOLDER_IMAGE } from '$lib/listing-images';
	import { conditionLabel } from '$lib/validation/listings';
	import { notifyFromResult } from '$lib/toast.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const listing = $derived(data.listing);
	const images = $derived(data.images);

	let selected = $state(0);
	const mainUrl = $derived(
		images.length ? images[Math.min(selected, images.length - 1)].url : PLACEHOLDER_IMAGE
	);

	const isSold = $derived(listing.status === 'sold');
	const isPublic = $derived(listing.status === 'active' || listing.status === 'sold');
	const condition = $derived(listing.condition ? conditionLabel(listing.condition) : null);

	// Message button (D3): shown only to a non-owner viewing an ACTIVE listing.
	// Sold/paused/removed/deleted never show it (paused/removed aren't publicly
	// reachable anyway; owners never see it on their own listing). Logged-out visitors
	// get a login link that returns here; authenticated non-owners post to the
	// startConversation action, which opens or resumes the thread.
	const canMessage = $derived(listing.status === 'active' && !data.isOwner);
	const loginHref = $derived(`/login?redirectTo=${encodeURIComponent(`/listings/${listing.id}`)}`);

	// Buy Now (D1/D3) gates on exactly the same conditions as the message button —
	// active listing, not your own — and then splits on the checkout hold:
	//   held by me    → resume the payment, or cancel it
	//   held by other → disabled, because create_pending_order would reject it
	//   no hold       → buy (form POST for signed-in, login link for anonymous)
	const canBuy = $derived(listing.status === 'active' && !data.isOwner);
	const hold = $derived(data.checkoutHold);

	let messaging = $state(false);
	const onMessage: SubmitFunction = () => {
		messaging = true;
		return async ({ result, update }) => {
			await update();
			if (result.type === 'failure') notifyFromResult(result);
			messaging = false;
		};
	};

	let buying = $state(false);
	const onBuy: SubmitFunction = () => {
		buying = true;
		return async ({ result, update }) => {
			// Paystack's hosted page is an EXTERNAL url, and goto() — which enhance
			// uses for redirects — refuses those. Hand it to the browser instead.
			// Without JS the native form POST follows the 303 by itself, so both
			// paths end up in the same place (D2).
			if (result.type === 'redirect') {
				window.location.assign(result.location);
				return;
			}
			await update();
			if (result.type === 'failure') notifyFromResult(result);
			buying = false;
		};
	};

	/**
	 * Recover the page whenever it becomes visible again with a handoff still
	 * "in flight".
	 *
	 * `onBuy` deliberately leaves `buying` true when it hands off to Paystack, so
	 * the spinner survives right up to the navigation. Coming back has to undo
	 * that — and the route back varies in ways we cannot detect from here. A
	 * cache-control: no-store response already stops the plain HTTP-cache replay,
	 * but Chrome still admits no-store pages to the BFCACHE, and whether a given
	 * return is a fresh load, a cache replay or a bfcache restore depends on how
	 * long the buyer sat on Paystack's page and on memory pressure.
	 *
	 * So key off the one signal every route back shares: the document becoming
	 * visible. `visibilitychange` fires on bfcache restore, on tab refocus and on
	 * a restored history entry, where `pageshow` demonstrably does NOT — an
	 * earlier attempt hooked pageshow and it never ran at all.
	 *
	 * Guarded on `buying` so this costs nothing on an ordinary tab switch: it
	 * only acts when we actually handed off and came back. invalidateAll refetches
	 * the hold, so the buyer gets Cancel rather than a dead Buy Now.
	 *
	 * `revalidating` covers the gap in between. Without it the restored snapshot —
	 * taken before the order existed — renders "Buy now" for a few hundred ms
	 * before the fresh data swaps it for "Resume payment / Cancel checkout". That
	 * flash is not merely ugly: the button is live during it, and clicking would
	 * hit create_pending_order, which rejects because a pending order already
	 * holds the listing.
	 */
	let revalidating = $state(false);

	$effect(() => {
		const onVisible = () => {
			if (document.visibilityState !== 'visible' || !buying) return;
			buying = false;
			// Hold a neutral state until the refetch lands, so the stale snapshot
			// never renders an actionable Buy Now for an item we already hold.
			revalidating = true;
			void invalidateAll().finally(() => {
				revalidating = false;
			});
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	});

	let cancelling = $state(false);
	const onCancel: SubmitFunction = () => {
		cancelling = true;
		return async ({ result, update }) => {
			await update();
			notifyFromResult(result, { success: 'Checkout cancelled.' });
			cancelling = false;
		};
	};

	const dateFull = new Intl.DateTimeFormat('en-KE', {
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});
	const monthYear = new Intl.DateTimeFormat('en-KE', { month: 'long', year: 'numeric' });
	const postedLabel = $derived(
		listing.published_at
			? `Posted ${dateFull.format(new Date(listing.published_at))}`
			: 'Not published yet'
	);
	const memberSince = $derived(
		data.seller?.created_at ? monthYear.format(new Date(data.seller.created_at)) : null
	);
	const metaDescription = $derived(
		(listing.description || `${listing.title} on MySoko`).replace(/\s+/g, ' ').slice(0, 155)
	);

	function initials(name: string | null | undefined): string {
		if (!name) return '?';
		return name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0]!.toUpperCase())
			.join('');
	}

	// Arrow keys move between thumbnails (the handler sits on each button, which is
	// already interactive, so the roving selection stays keyboard-accessible).
	function onThumbKey(event: KeyboardEvent) {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		const dir = event.key === 'ArrowRight' ? 1 : -1;
		selected = Math.max(0, Math.min(images.length - 1, selected + dir));
		const buttons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll('button');
		(buttons?.[selected] as HTMLButtonElement | undefined)?.focus();
	}
</script>

<svelte:head>
	<title>{listing.title} · MySoko</title>
	<meta name="description" content={metaDescription} />
</svelte:head>

<main class="mx-auto max-w-5xl px-4 py-6 sm:py-8">
	{#if !isPublic}
		<Alert variant="info" class="mb-4">
			{listing.status === 'draft'
				? 'This listing is a draft — only you can see it.'
				: 'This listing was removed — only you can see it.'}
		</Alert>
	{/if}

	<!-- Breadcrumb -->
	{#if data.breadcrumb}
		<nav class="flex flex-wrap items-center gap-1.5 text-sm text-subtle" aria-label="Breadcrumb">
			<a href="/" class="hover:text-ink">Home</a>
			<span aria-hidden="true">/</span>
			<a href={`/c/${data.breadcrumb.top.slug}`} class="hover:text-ink"
				>{data.breadcrumb.top.name}</a
			>
			<span aria-hidden="true">/</span>
			<a href={`/c/${data.breadcrumb.sub.slug}`} class="hover:text-ink"
				>{data.breadcrumb.sub.name}</a
			>
		</nav>
	{/if}

	<div class="mt-4 grid gap-8 lg:grid-cols-2">
		<!-- Gallery -->
		<div>
			<div
				class="relative aspect-4/3 overflow-hidden rounded-card border border-border bg-neutral-tint"
			>
				<img src={mainUrl} alt={listing.title} class="h-full w-full object-contain" />
				{#if isSold}
					<div class="absolute inset-0 flex items-center justify-center bg-ink/40">
						<span
							class="rounded-control bg-ink px-5 py-2 font-display text-lg font-bold tracking-wider text-white uppercase"
						>
							Sold
						</span>
					</div>
				{/if}
			</div>

			{#if images.length > 1}
				<div class="mt-3 flex flex-wrap gap-2" role="group" aria-label="Photos">
					{#each images as img, i (img.id)}
						<button
							type="button"
							onclick={() => (selected = i)}
							onkeydown={onThumbKey}
							aria-label={`View photo ${i + 1}`}
							aria-current={i === selected ? 'true' : undefined}
							class={`h-16 w-16 flex-none overflow-hidden rounded-control border-2 transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none ${
								i === selected ? 'border-brand' : 'border-border hover:border-subtle'
							}`}
						>
							<img src={img.url} alt="" class="h-full w-full object-cover" />
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Details -->
		<div>
			<h1 class="font-display text-2xl font-bold text-ink">{listing.title}</h1>
			<div class="mt-2"><Price amount={listing.price} size="xl" /></div>

			{#if condition}
				<div class="mt-3">
					<Badge variant={listing.condition === 'new' ? 'accent' : 'neutral'}>{condition}</Badge>
				</div>
			{/if}
			<p class="mt-2 text-sm text-muted">{listing.location_area ?? 'Nairobi'} · {postedLabel}</p>

			{#if canBuy}
				<div class="mt-5">
					{#if revalidating}
						<!-- Returning from Paystack: the restored page still holds the data
						     from before the order existed, so rendering it would flash an
						     actionable "Buy now" that create_pending_order would reject.
						     Hold a neutral state for the few hundred ms the refetch takes. -->
						<Button disabled loading class="w-full sm:w-auto">Checking your checkout</Button>
					{:else if hold?.heldByMe}
						<div class="flex flex-col gap-2 sm:flex-row">
							{#if hold.authorizationUrl}
								<Button href={hold.authorizationUrl} class="w-full sm:w-auto">Resume payment</Button
								>
							{/if}
							<form method="POST" action="?/cancelCheckout" use:enhance={onCancel}>
								<input type="hidden" name="orderId" value={hold.orderId} />
								<Button
									type="submit"
									variant="secondary"
									loading={cancelling}
									class="w-full sm:w-auto"
								>
									Cancel checkout
								</Button>
							</form>
						</div>
						<p class="mt-2 text-sm text-muted">
							{hold.authorizationUrl
								? 'Your checkout is still open. It expires 30 minutes after you started it.'
								: 'Your checkout is open but its payment link is missing. Cancel it to start again.'}
						</p>
					{:else if hold}
						<Button disabled class="w-full sm:w-auto">Checkout in progress</Button>
						<p class="mt-2 text-sm text-muted">
							Someone else is paying for this item. Check back in a few minutes.
						</p>
					{:else if data.session}
						<form method="POST" action="?/buy" use:enhance={onBuy}>
							<Button type="submit" loading={buying} class="w-full sm:w-auto">Buy now</Button>
						</form>
					{:else}
						<Button href={loginHref} class="w-full sm:w-auto">Buy now</Button>
					{/if}
				</div>
			{/if}

			{#if canMessage}
				<div class="mt-3">
					{#if data.session}
						<form method="POST" action="?/message" use:enhance={onMessage}>
							<Button
								type="submit"
								variant="secondary"
								loading={messaging}
								class="w-full sm:w-auto"
							>
								{data.existingConversationId ? 'View conversation' : 'Message seller'}
							</Button>
						</form>
					{:else}
						<Button href={loginHref} variant="secondary" class="w-full sm:w-auto">
							Message seller
						</Button>
					{/if}
				</div>
			{/if}

			<div class="my-6 border-t border-border"></div>

			<h2 class="text-sm font-semibold text-ink">Description</h2>
			{#if listing.description}
				<p class="mt-2 text-sm leading-relaxed whitespace-pre-line text-ink">
					{listing.description}
				</p>
			{:else}
				<p class="mt-2 text-sm text-subtle">No description provided.</p>
			{/if}

			<div class="my-6 border-t border-border"></div>

			<div class="flex items-center gap-3">
				{#if data.seller?.avatar_url}
					<img src={data.seller.avatar_url} alt="" class="h-11 w-11 rounded-pill object-cover" />
				{:else}
					<span
						class="flex h-11 w-11 items-center justify-center rounded-pill bg-brand-tint text-sm font-semibold text-brand-strong"
					>
						{initials(data.seller?.full_name)}
					</span>
				{/if}
				<div>
					<p class="font-medium text-ink">{data.seller?.full_name ?? 'Seller'}</p>
					{#if memberSince}<p class="text-xs text-subtle">Member since {memberSince}</p>{/if}
				</div>
			</div>
		</div>
	</div>
</main>
