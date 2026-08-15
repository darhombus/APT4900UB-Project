<script lang="ts">
	import { enhance } from '$app/forms';
	import { Alert, Badge, Button, Card, Price, Stars, Textarea } from '$lib/components/ui';
	import { ReviewByline } from '$lib/components';
	import { PLACEHOLDER_IMAGE } from '$lib/listing-images';
	import { disputeStatusView, disputeSummary } from '$lib/disputes';
	import { centsToMajor, orderStatusLabel, orderStatusVariant } from '$lib/orders';
	import { REVIEW_RESPONSE_MAX, averageRating, reviewCountLabel } from '$lib/reviews';
	import { notifyFromResult } from '$lib/toast.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const dateFmt = new Intl.DateTimeFormat('en-KE', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});

	type Dispute = NonNullable<PageData['sales'][number]['dispute']>;

	// Section 6. One reply per review, ever (D5) — a review either shows the
	// seller's reply or the form to write it, never both and never an edit.
	const awaitingReply = $derived(data.reviews.filter((r) => r.sellerResponse === null).length);

	// The seller's own rating, across every listing they have sold. Null until
	// someone reviews them, in which case the whole section is hidden anyway.
	const sellerAverage = $derived(averageRating(data.sellerAggregate));

	// Which review the enhanced submit is in flight for, so only that form's
	// button spins rather than every button on the page.
	let respondingTo = $state<string | null>(null);
	const onRespond: SubmitFunction = ({ formData }) => {
		respondingTo = String(formData.get('reviewId') ?? '');
		return async ({ result, update }) => {
			await update();
			notifyFromResult(result, { redirect: 'Reply posted.' });
			respondingTo = null;
		};
	};
</script>

<svelte:head><title>Your sales · MySoko</title></svelte:head>

<!--
	The seller's dispute view (ADM-1, Section 6). One snippet, two render sites:
	this page renders its sales TWICE — cards below sm, a table above — and the
	seller has no per-order detail route, so this list is the only place a seller
	can see a dispute at all. Read-only: ADM-1 makes disputes buyer-initiated and
	ADM-7 makes every transition RPC-only, so there is nothing here for a seller
	to act on. Saying so plainly beats offering a control that would be refused.
-->
{#snippet disputePanel(dispute: Dispute)}
	{@const view = disputeStatusView(dispute.status)}
	<div class="mt-3 rounded-card border border-error/30 bg-error-tint/40 p-3">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<span class="text-xs font-medium text-ink">Problem reported</span>
			<Badge variant={view.variant}>{view.label}</Badge>
		</div>

		<p class="mt-2 text-sm text-muted">{disputeSummary(dispute.status, 'seller')}</p>

		<!-- The buyer's own words, rendered as TEXT. Never markup. -->
		<p class="mt-2 text-sm whitespace-pre-wrap text-muted">“{dispute.reason}”</p>

		{#if dispute.resolutionNote}
			<p class="mt-2 text-xs font-medium text-subtle">Our decision</p>
			<p class="mt-1 text-sm whitespace-pre-wrap text-muted">{dispute.resolutionNote}</p>
		{/if}

		<p class="mt-2 text-xs text-subtle">
			Reported {dateFmt.format(new Date(dispute.createdAt))}
			{#if dispute.resolvedAt}
				· settled {dateFmt.format(new Date(dispute.resolvedAt))}
			{/if}
		</p>
	</div>
{/snippet}

<main class="mx-auto max-w-4xl px-4 py-6 sm:py-8">
	<h1 class="font-display text-2xl font-bold text-ink">Your sales</h1>

	{#if data.sales.length === 0}
		<Card class="mt-6 p-8 text-center">
			<p class="text-sm text-muted">No sales yet. They'll show up here once a buyer pays.</p>
			<div class="mt-4">
				<Button href="/sell/listings" variant="secondary">Your listings</Button>
			</div>
		</Card>
	{:else}
		<Card class="mt-6 p-4">
			<div class="flex items-baseline justify-between gap-4">
				<span class="text-sm text-muted">Earned from completed orders</span>
				<Price amount={centsToMajor(data.completedNet)} size="lg" />
			</div>

			<!-- ADM-15. The withheld money is NAMED rather than silently missing from
			     the total above. A figure that shrinks with no explanation is the dead
			     end ADM-13 exists to prevent, and it would land here: a seller would
			     see a smaller number and no reason for it.
			     `held` is temporary and will resolve; `refunded` is final. They are
			     separate lines because the seller is owed different words. -->
			{#if data.heldNet > 0 || data.refundedNet > 0}
				<dl class="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
					{#if data.heldNet > 0}
						<div class="flex items-baseline justify-between gap-4">
							<dt class="text-muted">On hold while a problem is settled</dt>
							<dd class="text-ink"><Price amount={centsToMajor(data.heldNet)} size="sm" /></dd>
						</div>
					{/if}
					{#if data.refundedNet > 0}
						<div class="flex items-baseline justify-between gap-4">
							<dt class="text-muted">Refunded to buyers</dt>
							<dd class="text-ink"><Price amount={centsToMajor(data.refundedNet)} size="sm" /></dd>
						</div>
					{/if}
				</dl>
				<p class="mt-2 text-xs text-subtle">
					{#if data.heldNet > 0 && data.refundedNet > 0}
						Money on hold is added back if the problem is settled in your favour. Refunded money has
						gone back to the buyer and is not paid out.
					{:else if data.heldNet > 0}
						This is added back to your earnings if the problem is settled in your favour.
					{:else}
						This has gone back to the buyer and is not paid out.
					{/if}
				</p>
			{/if}
		</Card>
		<!-- N2 — this is lifetime earnings; /sell/payouts shows what is withdrawable
		     TODAY, which is smaller once the hold and past payouts are taken off. The
		     two figures differ by design, and a seller comparing them should be told
		     why rather than left to suspect a bug. Copy only: the card above, the
		     query and the sum are unchanged. -->
		<p class="mt-2 text-xs text-subtle">
			Everything you've earned, all time. For what you can withdraw right now, see
			<a href="/sell/payouts" class="underline hover:text-muted">payouts</a>.
		</p>

		<!-- Cards on small screens, a table from sm up: the split is five numbers
		     per row, which a phone-width table can't show without scrolling. -->
		<ul class="mt-4 space-y-3 sm:hidden">
			{#each data.sales as sale (sale.id)}
				<li>
					<Card class="p-3">
						<div class="flex items-center gap-3">
							<img
								src={sale.coverUrl ?? PLACEHOLDER_IMAGE}
								alt=""
								class="h-12 w-12 flex-none rounded-control border border-border object-cover"
							/>
							<div class="min-w-0 flex-1">
								<p class="truncate font-medium text-ink">{sale.title}</p>
								<p class="text-xs text-subtle">
									{sale.buyerName} · {dateFmt.format(new Date(sale.createdAt))}
								</p>
							</div>
							<Badge variant={orderStatusVariant(sale.status)}>
								{orderStatusLabel(sale.status)}
							</Badge>
						</div>
						<dl class="mt-3 space-y-1 border-t border-border pt-3 text-sm">
							<div class="flex justify-between gap-4">
								<dt class="text-muted">Total</dt>
								<dd class="text-ink"><Price amount={centsToMajor(sale.amountTotal)} /></dd>
							</div>
							<div class="flex justify-between gap-4">
								<dt class="text-muted">Platform fee</dt>
								<dd class="text-subtle">
									{#if sale.commissionAmount === null}—{:else}
										<Price amount={centsToMajor(sale.commissionAmount)} />
									{/if}
								</dd>
							</div>
							<div class="flex justify-between gap-4">
								<dt class="font-medium text-ink">You receive</dt>
								<dd class="font-medium text-ink">
									{#if sale.sellerNet === null}—{:else}
										<Price amount={centsToMajor(sale.sellerNet)} />
									{/if}
								</dd>
							</div>
						</dl>
						{#if sale.dispute}
							{@render disputePanel(sale.dispute)}
						{/if}
					</Card>
				</li>
			{/each}
		</ul>

		<div class="mt-4 hidden overflow-x-auto sm:block">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-border text-left text-xs text-subtle">
						<th class="py-2 pr-4 font-medium">Listing</th>
						<th class="py-2 pr-4 font-medium">Buyer</th>
						<th class="py-2 pr-4 font-medium">Date</th>
						<th class="py-2 pr-4 text-right font-medium">Total</th>
						<th class="py-2 pr-4 text-right font-medium">Platform fee</th>
						<th class="py-2 pr-4 text-right font-medium">You receive</th>
						<th class="py-2 font-medium">Status</th>
					</tr>
				</thead>
				<tbody>
					{#each data.sales as sale (sale.id)}
						<tr class="border-b border-border last:border-0">
							<td class="py-3 pr-4">
								<div class="flex items-center gap-2">
									<img
										src={sale.coverUrl ?? PLACEHOLDER_IMAGE}
										alt=""
										class="h-9 w-9 flex-none rounded-control border border-border object-cover"
									/>
									<span class="max-w-[16ch] truncate text-ink">{sale.title}</span>
								</div>
							</td>
							<td class="py-3 pr-4 text-ink">{sale.buyerName}</td>
							<td class="py-3 pr-4 text-subtle">{dateFmt.format(new Date(sale.createdAt))}</td>
							<td class="py-3 pr-4 text-right text-ink">
								<Price amount={centsToMajor(sale.amountTotal)} />
							</td>
							<td class="py-3 pr-4 text-right text-subtle">
								{#if sale.commissionAmount === null}—{:else}
									<Price amount={centsToMajor(sale.commissionAmount)} />
								{/if}
							</td>
							<td class="py-3 pr-4 text-right font-medium text-ink">
								{#if sale.sellerNet === null}—{:else}
									<Price amount={centsToMajor(sale.sellerNet)} />
								{/if}
							</td>
							<td class="py-3">
								<Badge variant={orderStatusVariant(sale.status)}>
									{orderStatusLabel(sale.status)}
								</Badge>
							</td>
						</tr>
						{#if sale.dispute}
							<!-- A full-width row beneath its sale rather than a column: the
							     buyer's words and the decision are prose, and prose does not
							     fit a table cell sized for a price. -->
							<tr class="border-b border-border last:border-0">
								<td colspan="7" class="pb-3">
									{@render disputePanel(sale.dispute)}
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<!-- Reviews (Section 6, R-13). Its own block rather than a column in the table
	     above: this page renders its sales TWICE — cards below sm, a table above —
	     so putting the form inline would duplicate every reply form, and a textarea
	     in a table cell is the wrong shape. Each review names its listing so the
	     seller can tell which sale it belongs to. -->
	{#if data.reviews.length > 0}
		<section class="mt-10">
			<div class="flex items-baseline justify-between gap-4">
				<h2 class="font-display text-lg font-bold text-ink">Reviews from buyers</h2>
				{#if awaitingReply > 0}
					<span class="text-xs text-subtle">
						{awaitingReply}
						{awaitingReply === 1 ? 'awaiting a reply' : 'awaiting replies'}
					</span>
				{/if}
			</div>

			<!-- The headline number: what buyers see about this seller. It spans ALL
			     their listings, so it is deliberately not a summary of the list below,
			     which is capped and can be a subset. -->
			{#if sellerAverage !== null}
				<p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
					<span class="text-sm font-medium text-muted">Your seller rating</span>
					<Stars average={sellerAverage} size="md" subject="You" />
					<span class="text-sm text-subtle">
						· {reviewCountLabel(data.sellerAggregate.reviewCount)} across all your listings
					</span>
				</p>
			{/if}

			<p class="mt-2 text-sm text-muted">
				You can reply once to each review. Replies are public and can't be edited afterwards.
			</p>

			{#if form?.responseError}
				<Alert variant="error" class="mt-4">{form.responseError}</Alert>
			{/if}

			<ul class="mt-4 space-y-3">
				{#each data.reviews as review (review.id)}
					<li>
						<Card class="p-4">
							<!-- ReviewByline is the shared core: who, what they gave, when, and
							     the listing it was about. The public list renders the same
							     component, so the byline cannot drift into two shapes. What is
							     NOT shared is the arrangement around it — this page keeps its
							     Card, its full-width body below, and the reply form.
							     "(removed)" rather than the public "(no longer available)":
							     this reader is the owner, and knows which of their own listings
							     they took down (SP-12). -->
							<ReviewByline {review} unavailableLabel="(removed)" />

							{#if review.body}
								<p class="mt-2 text-sm leading-relaxed whitespace-pre-line text-ink">
									{review.body}
								</p>
							{/if}

							{#if review.sellerResponse}
								<!-- Answered: read-only, no edit and no delete (D5). -->
								<div class="mt-3 border-l-2 border-brand/30 bg-brand-tint/40 py-2 pl-3">
									<p class="text-xs font-medium text-brand-strong">
										Your reply{review.sellerRespondedAt
											? ` · ${dateFmt.format(new Date(review.sellerRespondedAt))}`
											: ''}
									</p>
									<p class="mt-1 text-sm leading-relaxed whitespace-pre-line text-ink">
										{review.sellerResponse}
									</p>
								</div>
							{:else}
								<!-- Plain POST form: works before hydration and with JS off (D12). -->
								<form
									method="POST"
									action="?/sellerRespond"
									use:enhance={onRespond}
									class="mt-3 border-t border-border pt-3"
								>
									<input type="hidden" name="reviewId" value={review.id} />
									<label
										for={`response-${review.id}`}
										class="mb-1 block text-sm font-medium text-ink"
									>
										Reply publicly
									</label>
									<Textarea
										id={`response-${review.id}`}
										name="response"
										rows={3}
										required
										maxlength={REVIEW_RESPONSE_MAX}
										placeholder="Thanks for the feedback…"
									/>
									<Button
										type="submit"
										variant="secondary"
										loading={respondingTo === review.id}
										class="mt-2 w-full sm:w-auto"
									>
										Post reply
									</Button>
								</form>
							{/if}
						</Card>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</main>
