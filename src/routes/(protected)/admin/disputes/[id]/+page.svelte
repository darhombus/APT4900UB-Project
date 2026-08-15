<script lang="ts">
	import { enhance } from '$app/forms';
	import { Alert, Badge, Button, Card, Input, Label, Price, Textarea } from '$lib/components/ui';
	import { centsToMajor, orderStatusLabel } from '$lib/orders';
	import { toast } from '$lib/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let outcome = $state<'resolved_refunded' | 'resolved_rejected' | ''>('');
	let submitting = $state(false);

	const isOpen = $derived(data.dispute.status === 'open');
	const isUnderReview = $derived(data.dispute.status === 'under_review');
	const isResolved = $derived(data.dispute.status.startsWith('resolved_'));

	const STATUS: Record<
		string,
		{ label: string; variant: 'warning' | 'brand' | 'success' | 'neutral' }
	> = {
		open: { label: 'Open', variant: 'warning' },
		under_review: { label: 'Under review', variant: 'brand' },
		resolved_refunded: { label: 'Refunded', variant: 'success' },
		resolved_rejected: { label: 'Rejected', variant: 'neutral' }
	};

	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' });

	// ADM-11: the money question, answered with what the data can actually
	// support — and NOT by comparing against `availableCents`, which excludes
	// this order precisely because the dispute is live. Reading 0 there means the
	// hold is working, not that the money is gone.
	//
	// Payouts are seller-scoped with no order attribution, so the only fully
	// certain statement is the one where nothing has ever been paid out. Anything
	// else is indeterminate and says so rather than guessing.
	const sellerNet = $derived(data.order?.seller_net ?? 0);
	const nothingPaidOut = $derived(data.payout.paidOutCents === 0);
</script>

<svelte:head><title>Dispute · Admin · MySoko</title></svelte:head>

<a href="/admin/disputes" class="text-sm text-muted hover:text-ink">← All disputes</a>

<div class="mt-4 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
	<div class="space-y-4">
		<Card>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<Badge variant={STATUS[data.dispute.status]?.variant ?? 'neutral'}>
					{STATUS[data.dispute.status]?.label ?? data.dispute.status}
				</Badge>
				<p class="text-xs text-subtle">
					Opened {dateFmt.format(new Date(data.dispute.created_at))}
				</p>
			</div>

			<h2 class="mt-4 font-display text-sm font-semibold text-ink">What the buyer says</h2>
			<p class="mt-1 whitespace-pre-wrap text-sm text-muted">{data.dispute.reason}</p>

			{#if data.dispute.resolution_note}
				<div class="mt-4 border-t border-border pt-4">
					<h2 class="font-display text-sm font-semibold text-ink">Decision</h2>
					<p class="mt-1 whitespace-pre-wrap text-sm text-muted">{data.dispute.resolution_note}</p>
					{#if data.dispute.refund_reference}
						<p class="mt-2 text-sm text-muted">
							Paystack refund reference
							<span class="tnum font-medium text-ink">{data.dispute.refund_reference}</span>
						</p>
					{/if}
					{#if data.dispute.resolved_at}
						<p class="mt-1 text-xs text-subtle">
							Resolved {dateFmt.format(new Date(data.dispute.resolved_at))}
						</p>
					{/if}
				</div>
			{/if}
		</Card>

		{#if !isResolved}
			<Card>
				<h2 class="font-display text-sm font-semibold text-ink">Decide this dispute</h2>

				{#if form?.actionError}
					<Alert variant="error" class="mt-3">{form.actionError}</Alert>
				{/if}

				{#if isOpen}
					<p class="mt-2 text-sm text-muted">
						Move it to under review to start working on it. The buyer is told it is being looked at.
					</p>
					<form
						method="POST"
						action="?/review"
						class="mt-4"
						use:enhance={() => {
							submitting = true;
							return async ({ update, result }) => {
								submitting = false;
								if (result.type === 'success') toast.success('Moved to under review');
								await update();
							};
						}}
					>
						<Button type="submit" loading={submitting}>Start review</Button>
					</form>
				{:else if isUnderReview}
					<form
						method="POST"
						action="?/resolve"
						class="mt-4 space-y-4"
						use:enhance={() => {
							submitting = true;
							return async ({ update, result }) => {
								submitting = false;
								if (result.type === 'success') toast.success('Dispute resolved');
								await update();
							};
						}}
					>
						<fieldset>
							<legend class="text-sm font-medium text-ink">Outcome</legend>
							<div class="mt-2 grid gap-2 sm:grid-cols-2">
								<label
									class="flex cursor-pointer items-start gap-2 rounded-control border p-3 text-sm transition-colors
										{outcome === 'resolved_refunded'
										? 'border-brand bg-brand-tint'
										: 'border-border hover:border-subtle/40'}"
								>
									<input
										type="radio"
										name="outcome"
										value="resolved_refunded"
										bind:group={outcome}
										class="mt-0.5 accent-brand"
									/>
									<span>
										<span class="font-medium text-ink">Refund the buyer</span>
										<span class="mt-0.5 block text-xs text-muted">Money goes back</span>
									</span>
								</label>
								<label
									class="flex cursor-pointer items-start gap-2 rounded-control border p-3 text-sm transition-colors
										{outcome === 'resolved_rejected'
										? 'border-brand bg-brand-tint'
										: 'border-border hover:border-subtle/40'}"
								>
									<input
										type="radio"
										name="outcome"
										value="resolved_rejected"
										bind:group={outcome}
										class="mt-0.5 accent-brand"
									/>
									<span>
										<span class="font-medium text-ink">Reject the claim</span>
										<span class="mt-0.5 block text-xs text-muted">Nothing moves</span>
									</span>
								</label>
							</div>
						</fieldset>

						{#if outcome === 'resolved_refunded'}
							<!-- ADM-3: refunds are manual this phase. The order matters and the
							     copy says so — dashboard first, reference second. -->
							<div class="rounded-control border border-warning/30 bg-warning-tint p-3">
								<p class="text-sm font-medium text-warning-strong">Refund in Paystack first</p>
								<p class="mt-1 text-sm text-warning-strong">
									Open the Paystack dashboard, refund
									<Price showCents amount={centsToMajor(data.order?.amount_total ?? 0)} size="sm" />
									against reference
									<span class="tnum font-medium">{data.order?.paystack_reference}</span>, then
									record the refund reference below. Recording it here does not move any money.
								</p>
							</div>

							<div>
								<Label for="refundReference">Paystack refund reference</Label>
								<Input id="refundReference" name="refundReference" required />
							</div>
						{/if}

						<div>
							<Label for="resolutionNote">Decision note</Label>
							<Textarea
								id="resolutionNote"
								name="resolutionNote"
								rows={3}
								required
								placeholder="What you found, and why this outcome."
							/>
						</div>

						<Button type="submit" loading={submitting} disabled={!outcome}>Resolve dispute</Button>
					</form>
				{/if}
			</Card>
		{/if}
	</div>

	<aside class="space-y-4">
		<Card>
			<h2 class="font-display text-sm font-semibold text-ink">Order</h2>
			{#if data.order}
				<dl class="mt-3 space-y-2 text-sm">
					<div class="flex justify-between gap-2">
						<dt class="text-muted">Total</dt>
						<dd><Price showCents amount={centsToMajor(data.order.amount_total)} size="sm" /></dd>
					</div>
					<div class="flex justify-between gap-2">
						<dt class="text-muted">Seller earns</dt>
						<dd><Price showCents amount={centsToMajor(data.order.seller_net ?? 0)} size="sm" /></dd>
					</div>
					<div class="flex justify-between gap-2">
						<dt class="text-muted">Status</dt>
						<dd class="text-ink">{orderStatusLabel(data.order.status)}</dd>
					</div>
					<div class="flex justify-between gap-2">
						<dt class="text-muted">Buyer</dt>
						<dd class="text-ink">
							<a class="hover:text-brand" href="/admin/users/{data.order.buyer_id}"
								>{data.buyerName}</a
							>
						</dd>
					</div>
					<div class="flex justify-between gap-2">
						<dt class="text-muted">Seller</dt>
						<dd class="text-ink">
							<a class="hover:text-brand" href="/admin/users/{data.order.seller_id}"
								>{data.sellerName}</a
							>
						</dd>
					</div>
				</dl>

				{#if data.listing}
					<a
						href="/listings/{data.listing.id}"
						class="mt-3 block truncate text-sm text-muted hover:text-brand"
					>
						{data.listing.title}
					</a>
				{/if}

				{#if data.conversationId}
					<a
						href="/messages/{data.conversationId}"
						class="mt-3 inline-block text-sm font-medium text-brand hover:text-brand-hover"
					>
						Read their messages →
					</a>
				{/if}
			{:else}
				<p class="mt-2 text-sm text-muted">The order for this dispute could not be loaded.</p>
			{/if}
		</Card>

		<!-- ADM-11. Answers the question an admin actually has before refunding:
		     is the money still here? -->
		<Card>
			<h2 class="font-display text-sm font-semibold text-ink">Seller balance</h2>
			<dl class="mt-3 space-y-2 text-sm">
				{#if !isResolved}
					<div class="flex justify-between gap-2">
						<dt class="text-muted">Withheld by this dispute</dt>
						<dd><Price showCents amount={centsToMajor(sellerNet)} size="sm" /></dd>
					</div>
				{/if}
				<div class="flex justify-between gap-2">
					<dt class="text-muted">Available to withdraw</dt>
					<dd><Price showCents amount={centsToMajor(data.payout.availableCents)} size="sm" /></dd>
				</div>
				<div class="flex justify-between gap-2">
					<dt class="text-muted">Already paid out</dt>
					<dd><Price showCents amount={centsToMajor(data.payout.paidOutCents)} size="sm" /></dd>
				</div>
			</dl>

			<p class="mt-3 text-xs text-subtle">
				{#if !isResolved}
					{#if nothingPaidOut}
						This seller has never been paid out, so this order's earnings are still on the platform.
						Resolving the dispute releases them.
					{:else}
						This order's earnings are withheld while the dispute is live. Payouts are not itemised
						per order, so whether an earlier payout already covered this order cannot be determined
						from the data.
					{/if}
				{:else}
					Resolved — this order's earnings are no longer withheld.
				{/if}
			</p>
		</Card>
	</aside>
</div>
