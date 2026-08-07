<script lang="ts">
	import ReviewByline from './ReviewByline.svelte';
	import type { ReviewView, SellerReviewView } from '$lib/server/reviews';

	/**
	 * The public review list — on a listing page, and on a seller profile (Reviews
	 * PRD Section 7, seller profile D3).
	 *
	 * Display only: no form lives here. The byline, stars, date and listing context
	 * come from ReviewByline, which the seller's sales page also renders; this
	 * component is the PUBLIC arrangement around it — rows divided by rules, the
	 * body aligned past the avatar, and a note when the list is capped.
	 *
	 * A seller response renders nested beneath the review it answers, indented and
	 * rule-marked so the reply is visibly subordinate to the review rather than
	 * reading as a second, competing review.
	 */
	interface Props {
		/**
		 * Rows carrying listing context (`SellerReviewView`) render it; plain
		 * `ReviewView` rows do not. Which one a surface passes is decided by whether
		 * its reviews are all about the SAME listing: on a listing page naming it
		 * per row would repeat the page's own title N times, while on a seller page
		 * the listing is the one thing a review cannot be read without.
		 */
		reviews: readonly (ReviewView | SellerReviewView)[];
		/** Set when the list is capped, so the page can say what it is showing. */
		total?: number;
		/** Passed through to ReviewByline — see its `unavailableLabel`. */
		unavailableLabel?: string;
	}

	let { reviews, total, unavailableLabel }: Props = $props();

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
			<ReviewByline {review} {unavailableLabel}>
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
			</ReviewByline>
		</li>
	{/each}
</ul>

{#if capped}
	<p class="mt-4 text-xs text-subtle">
		Showing the {reviews.length} most recent of {total} reviews.
	</p>
{/if}
