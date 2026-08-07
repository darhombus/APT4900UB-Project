<script lang="ts">
	import { Avatar, Stars } from '$lib/components/ui';
	import { ListingCard, ReviewList } from '$lib/components';
	import { averageRating, formatAverage, reviewCountLabel } from '$lib/reviews';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const seller = $derived(data.seller);

	// Plain mean, null when there are no reviews — never 0.0, which reads as a bad
	// rating rather than an absent one (D2).
	const average = $derived(
		averageRating({ reviewCount: seller.review_count, ratingSum: seller.rating_sum })
	);

	const monthYear = new Intl.DateTimeFormat('en-KE', { month: 'long', year: 'numeric' });
	const memberSince = $derived(
		seller.created_at ? monthYear.format(new Date(seller.created_at)) : null
	);

	const capped = $derived(data.listingTotal > data.listings.length);
</script>

<svelte:head>
	<title>{seller.full_name} — MySoko</title>
	<meta
		name="description"
		content={`${seller.full_name} on MySoko: ${reviewCountLabel(seller.review_count)} and ${data.listingTotal} active ${data.listingTotal === 1 ? 'listing' : 'listings'}.`}
	/>
</svelte:head>

<main class="mx-auto max-w-5xl px-4 py-6 sm:py-8">
	<!-- 1 + 2. Identity and the seller-level aggregate, together: this page exists
	     because a reputation should be readable in one place, so who they are and
	     what buyers said about them are one block rather than two. The listing
	     page's seller block is the same content at byline scale — a reader arriving
	     from it should recognise this as the same thing, larger. -->
	<header class="flex items-start gap-4">
		<Avatar src={seller.avatar_url} name={seller.full_name} size="lg" />

		<div class="min-w-0 flex-1">
			<h1 class="font-display text-xl font-bold wrap-break-word text-ink sm:text-2xl">
				{seller.full_name}
			</h1>

			{#if average !== null}
				<p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
					<span class="tnum font-display text-lg font-bold text-ink">
						{formatAverage(average)}
					</span>
					<Stars {average} size="md" showValue={false} subject={seller.full_name} />
					<span class="text-sm text-subtle">{reviewCountLabel(seller.review_count)}</span>
				</p>
			{:else}
				<p class="mt-1 text-sm text-subtle">No reviews yet</p>
			{/if}

			{#if memberSince}
				<p class="mt-0.5 text-xs text-subtle">Member since {memberSince}</p>
			{/if}
		</div>
	</header>

	<div class="my-6 border-t border-border"></div>

	<!-- 3. Every review of this seller, across all their listings — including ones
	     they have since taken down. That is the whole point of the page: a seller
	     cannot shed their history by deleting the listing it happened on. -->
	<section>
		<h2 class="text-sm font-semibold text-ink">
			Reviews{#if data.reviewTotal}<span class="ml-1 font-normal text-subtle"
					>({data.reviewTotal})</span
				>{/if}
		</h2>

		{#if data.reviews.length === 0}
			<!-- The header has already said "No reviews yet" a few lines up, so this
			     says the other half — what fills the space — rather than repeating
			     the absence or defining what a review is. -->
			<p class="mt-2 text-sm text-subtle">
				Reviews will appear here once buyers complete an order.
			</p>
		{:else}
			<div class="mt-4">
				<ReviewList reviews={data.reviews} total={data.reviewTotal} />
			</div>
		{/if}
	</section>

	<div class="my-6 border-t border-border"></div>

	<!-- 4. What they have for sale right now. Capped rather than paginated (SP-9):
	     the review list above is capped too, and one page wants one treatment. -->
	<section>
		<div class="flex items-baseline justify-between gap-3">
			<h2 class="text-sm font-semibold text-ink">
				Active listings{#if data.listingTotal}<span class="ml-1 font-normal text-subtle"
						>({data.listingTotal})</span
					>{/if}
			</h2>
			{#if capped}
				<p class="text-xs text-subtle">
					Showing {data.listings.length} of {data.listingTotal}
				</p>
			{/if}
		</div>

		{#if data.listings.length === 0}
			<div class="mt-4 rounded-card border border-dashed border-border bg-surface p-10 text-center">
				<p class="text-sm text-muted">No active listings</p>
			</div>
		{:else}
			<div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
				{#each data.listings as listing (listing.id)}
					<ListingCard {listing} />
				{/each}
			</div>
		{/if}
	</section>
</main>
