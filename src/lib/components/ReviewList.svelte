<script lang="ts">
	import { Stars } from '$lib/components/ui';
	import type { ReviewView } from '$lib/server/reviews';

	/**
	 * The public review list on a listing page (Reviews PRD Section 7).
	 *
	 * Display only — no form lives here. A seller response renders nested beneath
	 * the review it answers, indented and rule-marked so the reply is visibly
	 * subordinate to the review rather than reading as a second, competing review.
	 */
	interface Props {
		reviews: ReviewView[];
		/** Set when the list is capped, so the page can say what it is showing. */
		total?: number;
	}

	let { reviews, total }: Props = $props();

	const dateFmt = new Intl.DateTimeFormat('en-KE', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});

	const capped = $derived(total !== undefined && total > reviews.length);
</script>

<ul class="divide-y divide-border">
	{#each reviews as review (review.id)}
		<li class="py-4 first:pt-0 last:pb-0">
			<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
				<Stars average={review.rating} showValue={false} />
				<span class="text-sm font-medium text-ink">{review.authorName}</span>
				<span class="text-xs text-subtle">
					{dateFmt.format(new Date(review.createdAt))}
				</span>
			</div>

			{#if review.body}
				<p class="mt-2 text-sm leading-relaxed whitespace-pre-line text-ink">{review.body}</p>
			{/if}

			{#if review.sellerResponse}
				<div class="mt-3 border-l-2 border-brand/30 bg-brand-tint/40 py-2 pl-3">
					<p class="text-xs font-medium text-brand-strong">
						Seller replied{review.sellerRespondedAt
							? ` · ${dateFmt.format(new Date(review.sellerRespondedAt))}`
							: ''}
					</p>
					<p class="mt-1 text-sm leading-relaxed whitespace-pre-line text-ink">
						{review.sellerResponse}
					</p>
				</div>
			{/if}
		</li>
	{/each}
</ul>

{#if capped}
	<p class="mt-4 text-xs text-subtle">
		Showing the {reviews.length} most recent of {total} reviews.
	</p>
{/if}
