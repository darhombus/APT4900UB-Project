<script lang="ts">
	import { Avatar, Stars } from '$lib/components/ui';
	import type { ReviewView } from '$lib/server/reviews';

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
