<script lang="ts">
	import { Avatar, Stars } from '$lib/components/ui';
	import type { ReviewView, SellerReviewView } from '$lib/server/reviews';

	/**
	 * The public review list on a listing page (Reviews PRD Section 7).
	 *
	 * Layout: avatar on the left, the reviewer's name on its own line, and the
	 * stars and date beneath it. Stars, name and date previously shared one row,
	 * which read as a run-on string with all three competing at the same weight.
	 * Split, each row has one job: WHO, then what they gave and when.
	 *
	 * Display only — no form lives here. A seller response renders nested beneath
	 * the review it answers, indented and rule-marked so the reply is visibly
	 * subordinate to the review rather than reading as a second, competing review.
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
		/**
		 * Marker for a listing this viewer has no page to reach (SP-12).
		 *
		 * The default is the PUBLIC wording, and it is deliberately vaguer than the
		 * truth: four statuses land here — draft, paused, removed and deleted — and
		 * a public reader neither knows nor should be told which one applies to
		 * someone else's listing. "(no longer available)" is accurate for all four.
		 * Seller-facing surfaces pass their own, more specific word.
		 */
		unavailableLabel?: string;
	}

	let { reviews, total, unavailableLabel = '(no longer available)' }: Props = $props();

	/** Present only on rows that carry a listing — see the `reviews` prop. */
	function listingOf(review: ReviewView | SellerReviewView): SellerReviewView | null {
		return 'listingTitle' in review ? review : null;
	}

	const dateFmt = new Intl.DateTimeFormat('en-KE', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});

	const capped = $derived(total !== undefined && total > reviews.length);
</script>

<ul class="divide-y divide-border">
	{#each reviews as review (review.id)}
		{@const listing = listingOf(review)}
		<li class="py-4 first:pt-0 last:pb-0">
			<div class="flex gap-3">
				<Avatar src={review.authorAvatarUrl} name={review.authorName} size="sm" />

				<!-- min-w-0 so a long name, or an unbroken word in the body, wraps
				     instead of pushing this column wider than its container. -->
				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium text-ink">{review.authorName}</p>
					<div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
						<Stars average={review.rating} showValue={false} subject={review.authorName} />
						<span class="text-xs text-subtle">
							{dateFmt.format(new Date(review.createdAt))}
						</span>
					</div>

					{#if listing}
						<!-- The listing the review is about. Linked when this viewer can
						     actually open it, plain text when they cannot — a link that is
						     certain to 404 is worse than no link. The embed answering both
						     questions is what makes `listingHref` the reachability test. -->
						{#if listing.listingHref}
							<a
								href={listing.listingHref}
								class="mt-1 block truncate text-xs text-subtle hover:text-ink hover:underline"
							>
								on {listing.listingTitle}
							</a>
						{:else}
							<p class="mt-1 truncate text-xs text-subtle">
								on {listing.listingTitle}
								<span class="text-subtle/70">{unavailableLabel}</span>
							</p>
						{/if}
					{/if}

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
				</div>
			</div>
		</li>
	{/each}
</ul>

{#if capped}
	<p class="mt-4 text-xs text-subtle">
		Showing the {reviews.length} most recent of {total} reviews.
	</p>
{/if}
