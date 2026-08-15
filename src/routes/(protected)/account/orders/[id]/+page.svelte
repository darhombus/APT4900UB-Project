<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		Alert,
		Badge,
		Button,
		Card,
		Label,
		Price,
		Stars,
		StarRatingInput,
		Textarea
	} from '$lib/components/ui';
	import {
		DISPUTE_REASON_MAX,
		DISPUTE_REASON_MIN,
		disputeStatusView,
		disputeSummary,
		disputeTimeline
	} from '$lib/disputes';
	import { PLACEHOLDER_IMAGE } from '$lib/listing-images';
	import {
		centsToMajor,
		isTerminalOrderStatus,
		orderStatusLabel,
		orderStatusVariant,
		orderTimeline
	} from '$lib/orders';
	import { REVIEW_BODY_MAX } from '$lib/reviews';
	import { notifyFromResult } from '$lib/toast.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

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

	let disputing = $state(false);
	const onOpenDispute: SubmitFunction = () => {
		disputing = true;
		return async ({ result, update }) => {
			await update();
			notifyFromResult(result, { redirect: 'Reported. Our team will look into it.' });
			disputing = false;
		};
	};

	/*
	 * THE REPORT PANEL'S <details> IS DELIBERATELY UNCONTROLLED — no `open`
	 * expression and no `bind:open`, matching the Confirm receipt panel above,
	 * which has never had this problem.
	 *
	 * Both controlled forms lose a race with hydration. The buyer's click opens
	 * the element NATIVELY, before hydration; Svelte then mounts, applies its own
	 * initial value (`false`), and the panel snaps shut with the buyer's text
	 * still in it. `bind:open` does not fix it — binding still writes the rune's
	 * initial value to the DOM on mount. Letting the browser own the element
	 * removes the second writer entirely.
	 *
	 * A refused submit is still visible: the error Alert renders OUTSIDE the
	 * <details>, and the textarea keeps what was typed via its `value`.
	 */

	// Reviews (Sections 4 and 5). The review area only exists on a completed
	// order; `canReview` decides form vs read-only, and a hidden review takes a
	// third path — it is neither editable nor re-writable while hidden.
	const review = $derived(data.review);
	const reviewHidden = $derived(review?.status === 'hidden');

	const dateFmt = new Intl.DateTimeFormat('en-KE', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});

	let submittingReview = $state(false);
	const onReviewSubmit: SubmitFunction = () => {
		submittingReview = true;
		return async ({ result, update }) => {
			await update();
			notifyFromResult(result, { redirect: 'Review posted. Thanks!' });
			submittingReview = false;
		};
	};

	let deletingReview = $state(false);
	const onReviewDelete: SubmitFunction = () => {
		deletingReview = true;
		return async ({ result, update }) => {
			await update();
			notifyFromResult(result, { redirect: 'Review removed.' });
			deletingReview = false;
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

	<!-- Review (Sections 4, 5). Only on a completed order — there is nothing to
	     review before the buyer has the item. -->
	{#if data.canReview || review}
		<Card class="mt-4 p-4">
			<h2 class="text-sm font-semibold text-ink">
				{review ? 'Your review' : 'Rate this seller'}
			</h2>

			{#if form?.reviewError}
				<Alert variant="error" class="mt-3">{form.reviewError}</Alert>
			{/if}

			{#if data.canReview}
				<p class="mt-1 text-sm text-muted">
					How was it? Your rating shows on the listing and on the seller's profile.
				</p>

				<form method="POST" action="?/reviewSubmit" use:enhance={onReviewSubmit} class="mt-3">
					<StarRatingInput error={form?.reviewError ? ' ' : undefined} />

					<div class="mt-3">
						<label for="body" class="mb-1 block text-sm font-medium text-ink">
							Add a comment <span class="font-normal text-subtle">(optional)</span>
						</label>
						<Textarea
							id="body"
							name="body"
							rows={4}
							maxlength={REVIEW_BODY_MAX}
							placeholder="What should other buyers know?"
						/>
					</div>

					<Button type="submit" loading={submittingReview} class="mt-3 w-full sm:w-auto">
						Post review
					</Button>
				</form>
			{:else if review}
				{#if reviewHidden}
					<!-- The author carve-out in reviews_select is what makes this state
					     visible at all. Saying so beats silently showing nothing, and the
					     slot is NOT free — the row still holds the order's unique index. -->
					<Alert variant="warning" class="mt-3">
						This review is hidden and isn't shown on the listing.
					</Alert>
				{/if}

				<div class="mt-3 flex items-center gap-2">
					<Stars average={review.rating} showValue={false} size="md" subject="You" />
					<span class="text-xs text-subtle">
						{dateFmt.format(new Date(review.createdAt))}
					</span>
				</div>

				{#if review.body}
					<p class="mt-2 text-sm leading-relaxed whitespace-pre-line text-ink">{review.body}</p>
				{/if}

				{#if review.sellerResponse}
					<div class="mt-3 rounded-control border-l-2 border-border bg-page py-2 pl-3">
						<p class="text-xs font-medium text-muted">
							Seller replied{review.sellerRespondedAt
								? ` · ${dateFmt.format(new Date(review.sellerRespondedAt))}`
								: ''}
						</p>
						<p class="mt-1 text-sm leading-relaxed whitespace-pre-line text-ink">
							{review.sellerResponse}
						</p>
					</div>
				{/if}

				<!-- Delete confirm as a native <details>, matching the confirm-receipt
				     pattern above: a real second action that works with JS off, and no
				     dependence on window.confirm (Section 5.2). A review cannot be
				     edited (D4) — removing it frees the slot to write a new one. -->
				<details class="mt-4 rounded-control border border-border">
					<summary
						class="cursor-pointer list-none px-3 py-2 text-sm text-muted hover:text-ink [&::-webkit-details-marker]:hidden"
					>
						Remove review
					</summary>
					<div class="border-t border-border px-3 py-3">
						<p class="text-sm text-muted">
							This deletes your rating and any reply from the seller. You can write a new review for
							this order afterwards.
						</p>
						<form method="POST" action="?/reviewDelete" use:enhance={onReviewDelete} class="mt-3">
							<input type="hidden" name="reviewId" value={review.id} />
							<Button
								type="submit"
								variant="secondary"
								loading={deletingReview}
								class="w-full sm:w-auto"
							>
								Remove review
							</Button>
						</form>
					</div>
				</details>
			{/if}
		</Card>
	{/if}

	<!-- Disputes (ADM-1). Shown when there is one to show, or when one can be
	     opened — never as an empty panel on an order nothing can happen to. -->
	{#if data.disputes.length > 0 || data.canOpenDispute}
		<Card class="mt-4 p-4">
			<h2 class="text-sm font-semibold text-ink">Problem with this order</h2>

			{#if form?.disputeError}
				<Alert variant="error" class="mt-3">{form.disputeError}</Alert>
			{/if}

			{#each data.disputes as dispute (dispute.id)}
				{@const view = disputeStatusView(dispute.status)}
				<div class="mt-3 rounded-card border border-border p-3">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<Badge variant={view.variant}>{view.label}</Badge>
						<p class="text-xs text-subtle">
							Reported {dateTimeFmt.format(new Date(dispute.created_at))}
						</p>
					</div>

					<p class="mt-2 text-sm text-muted">{disputeSummary(dispute.status, 'buyer')}</p>

					<!-- The buyer's own words, read back. Whitespace preserved and
					     rendered as text — never as markup. -->
					<p class="mt-3 text-xs font-medium text-subtle">What you reported</p>
					<p class="mt-1 text-sm whitespace-pre-wrap text-muted">{dispute.reason}</p>

					{#if dispute.resolution_note}
						<p class="mt-3 text-xs font-medium text-subtle">Our decision</p>
						<p class="mt-1 text-sm whitespace-pre-wrap text-muted">{dispute.resolution_note}</p>
					{/if}

					<ol class="mt-3 space-y-2">
						{#each disputeTimeline(dispute) as step (step.label)}
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
				</div>
			{/each}

			{#if data.canOpenDispute}
				<!-- A native <details>, matching Confirm receipt above: reporting a
				     problem is a deliberate second action, and this works with
				     JavaScript off. -->
				<details class="mt-3 rounded-card border border-border">
					<summary
						class="cursor-pointer list-none px-4 py-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden"
					>
						{data.disputes.length > 0 ? 'Report another problem' : 'Report a problem'}
					</summary>
					<div class="border-t border-border px-4 py-3">
						<p class="text-sm text-muted">
							Tell us what went wrong and our team will look into it. The seller is told that you
							have reported a problem, and their payment for this order is held until it is settled.
						</p>
						<form method="POST" action="?/openDispute" use:enhance={onOpenDispute} class="mt-3">
							<Label for="reason">What went wrong?</Label>
							<Textarea
								id="reason"
								name="reason"
								rows={4}
								required
								minlength={DISPUTE_REASON_MIN}
								maxlength={DISPUTE_REASON_MAX}
								value={form?.disputeReason ?? ''}
								placeholder="For example: the item never arrived, or it was not what was described."
							/>
							<p class="mt-1 text-xs text-subtle">
								At least {DISPUTE_REASON_MIN} characters.
							</p>
							<Button type="submit" loading={disputing} class="mt-3 w-full sm:w-auto">
								Report the problem
							</Button>
						</form>
					</div>
				</details>
			{/if}
		</Card>
	{/if}

	{#if data.messageHref}
		<div class="mt-4">
			<Button href={data.messageHref} variant="ghost" class="w-full sm:w-auto">
				Message seller
			</Button>
		</div>
	{/if}
</main>
