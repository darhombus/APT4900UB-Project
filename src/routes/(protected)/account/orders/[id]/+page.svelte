<script lang="ts">
	import { enhance } from '$app/forms';
	import { Badge, Button, Card, Price } from '$lib/components/ui';
	import { PLACEHOLDER_IMAGE } from '$lib/listing-images';
	import {
		centsToMajor,
		isTerminalOrderStatus,
		orderStatusLabel,
		orderStatusVariant,
		orderTimeline
	} from '$lib/orders';
	import { notifyFromResult } from '$lib/toast.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const order = $derived(data.order);
	const timeline = $derived(orderTimeline(order));
	const isPending = $derived(order.status === 'pending_payment');
	const isPaid = $derived(order.status === 'paid');
	const noActions = $derived(isTerminalOrderStatus(order.status));

	const dateTimeFmt = new Intl.DateTimeFormat('en-KE', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});

	let confirming = $state(false);
	const onConfirm: SubmitFunction = () => {
		confirming = true;
		return async ({ result, update }) => {
			await update();
			notifyFromResult(result, { redirect: 'Receipt confirmed. Thanks!' });
			confirming = false;
		};
	};

	let cancelling = $state(false);
	const onCancel: SubmitFunction = () => {
		cancelling = true;
		return async ({ result, update }) => {
			await update();
			notifyFromResult(result, { redirect: 'Checkout cancelled.' });
			cancelling = false;
		};
	};
</script>

<svelte:head><title>Order · MySoko</title></svelte:head>

<main class="mx-auto max-w-2xl px-4 py-6 sm:py-8">
	<a href="/account/orders" class="text-sm text-subtle hover:text-ink">← All orders</a>

	<div class="mt-3 flex items-start justify-between gap-4">
		<h1 class="font-display text-2xl font-bold text-ink">Order</h1>
		<Badge variant={orderStatusVariant(order.status)}>{orderStatusLabel(order.status)}</Badge>
	</div>

	<!-- Listing snapshot -->
	<Card class="mt-5 p-4">
		<div class="flex gap-4">
			<img
				src={data.listing.coverUrl ?? PLACEHOLDER_IMAGE}
				alt=""
				class="h-16 w-16 flex-none rounded-control border border-border object-cover"
			/>
			<div class="min-w-0 flex-1">
				{#if data.listing.href}
					<a href={data.listing.href} class="truncate font-medium text-ink hover:underline">
						{data.listing.title}
					</a>
				{:else}
					<p class="truncate font-medium text-ink">{data.listing.title}</p>
				{/if}
				<div class="mt-1"><Price amount={centsToMajor(order.amountTotal)} size="lg" /></div>
			</div>
		</div>

		<dl class="mt-4 space-y-1.5 border-t border-border pt-4 text-sm">
			<div class="flex items-baseline justify-between gap-4">
				<dt class="text-muted">Total paid</dt>
				<dd class="font-medium text-ink">
					<Price amount={centsToMajor(order.amountTotal)} />
				</dd>
			</div>
			<div class="flex items-baseline justify-between gap-4">
				<dt class="text-muted">Reference</dt>
				<dd class="truncate font-mono text-xs text-ink">{order.reference}</dd>
			</div>
		</dl>
	</Card>

	<!-- Status timeline -->
	<Card class="mt-4 p-4">
		<h2 class="text-sm font-semibold text-ink">Progress</h2>
		<ol class="mt-3 space-y-3">
			{#each timeline as step (step.label)}
				<li class="flex items-start gap-3">
					<span
						class={`mt-1.5 h-2 w-2 flex-none rounded-pill ${step.done ? 'bg-brand' : 'bg-border'}`}
						aria-hidden="true"
					></span>
					<div>
						<p class={`text-sm ${step.done ? 'font-medium text-ink' : 'text-subtle'}`}>
							{step.label}
						</p>
						{#if step.at}
							<p class="text-xs text-subtle">{dateTimeFmt.format(new Date(step.at))}</p>
						{/if}
					</div>
				</li>
			{/each}
		</ol>
	</Card>

	<!-- Actions -->
	{#if !noActions}
		<div class="mt-4 flex flex-col gap-2">
			{#if isPending}
				{#if order.authorizationUrl}
					<Button href={order.authorizationUrl} class="w-full">Resume payment</Button>
				{/if}
				<form method="POST" action="?/cancelCheckout" use:enhance={onCancel}>
					<Button type="submit" variant="secondary" loading={cancelling} class="w-full">
						Cancel checkout
					</Button>
				</form>
			{:else if isPaid}
				<!-- Confirm step as a native <details>: a real second action, and it
				     works with JavaScript off. -->
				<details class="rounded-card border border-border bg-surface">
					<summary
						class="cursor-pointer list-none px-4 py-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden"
					>
						Confirm receipt
					</summary>
					<div class="border-t border-border px-4 py-3">
						<p class="text-sm text-muted">
							Only confirm once you have the item. This closes the order and releases payment to the
							seller.
						</p>
						<form method="POST" action="?/confirmReceipt" use:enhance={onConfirm} class="mt-3">
							<Button type="submit" loading={confirming} class="w-full sm:w-auto">
								Yes, I've received it
							</Button>
						</form>
					</div>
				</details>
			{/if}
		</div>
	{/if}

	{#if data.messageHref}
		<div class="mt-4">
			<Button href={data.messageHref} variant="ghost" class="w-full sm:w-auto">
				Message seller
			</Button>
		</div>
	{/if}
</main>
