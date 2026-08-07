<script lang="ts">
	import { Avatar, Stars } from '$lib/components/ui';
	import type { ReviewView, SellerReviewView } from '$lib/server/reviews';
	import type { Snippet } from 'svelte';

	/**
	 * Who left a review, what they gave, and when — plus the listing it was about
	 * on surfaces that need it (SP-14).
	 *
	 * This is the part every review surface renders identically. What they do NOT
	 * share is everything around it: the public list divides its rows with rules,
	 * the seller's sales page puts each in a Card and hangs a reply form off it,
	 * and the two place the review body differently. An earlier ruling took the
	 * shared DATA for a shared shape and would have folded whole rows together;
	 * this is the part that is actually common.
	 *
	 * Layout: avatar on the left, the reviewer's name on its own line, and the
	 * stars and date beneath it. Stars, name and date previously shared one row,
	 * which read as a run-on string with all three competing at the same weight.
	 * Split, each row has one job: WHO, then what they gave and when.
	 */
	interface Props {
		review: ReviewView | SellerReviewView;
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
		/**
		 * Rendered inside the text column, under the byline. The public list puts
		 * the review body here so it aligns past the avatar; the sales page renders
		 * its body outside this component instead, full width under the Card. Both
		 * placements predate this extraction and neither is changed by it.
		 */
		children?: Snippet;
	}

	let { review, unavailableLabel = '(no longer available)', children }: Props = $props();

	const dateFmt = new Intl.DateTimeFormat('en-KE', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});

	/**
	 * Listing context is carried by the ROW, not by a flag: a seller surface passes
	 * `SellerReviewView` and gets it, a listing page passes `ReviewView` and does
	 * not — where naming the listing per row would repeat the page's own title.
	 */
	const listing = $derived('listingTitle' in review ? review : null);
</script>

<div class="flex gap-3">
	<Avatar src={review.authorAvatarUrl} name={review.authorName} size="sm" />

	<!-- min-w-0 so a long name, or an unbroken word in the body, wraps instead of
	     pushing this column wider than its container. -->
	<div class="min-w-0 flex-1">
		<p class="text-sm font-medium text-ink">{review.authorName}</p>
		<div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
			<Stars average={review.rating} showValue={false} subject={review.authorName} />
			<span class="text-xs text-subtle">
				{dateFmt.format(new Date(review.createdAt))}
			</span>
		</div>

		{#if listing}
			<!-- Linked when this viewer can actually open it, plain text when they
			     cannot — a link that is certain to 404 is worse than no link. The
			     embed answering both questions is what makes `listingHref` the
			     reachability test. -->
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

		{@render children?.()}
	</div>
</div>
