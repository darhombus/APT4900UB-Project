<script lang="ts">
	import { Badge, Price } from '$lib/components/ui';
	import { conditionLabel } from '$lib/validation/listings';
	import type { ListingCardData } from '$lib/listings-view';

	let { listing }: { listing: ListingCardData } = $props();

	const condition = $derived(listing.condition ? conditionLabel(listing.condition) : null);
</script>

<a
	href={`/listings/${listing.id}`}
	class="group block overflow-hidden rounded-card border border-border bg-surface shadow-card transition-shadow hover:shadow-menu focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-page focus-visible:outline-none"
>
	<div class="relative aspect-[4/3] overflow-hidden bg-neutral-tint">
		<img
			src={listing.coverUrl}
			alt={listing.title}
			loading="lazy"
			class="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
		/>
		{#if condition}
			<span class="absolute top-2 left-2">
				<Badge variant={listing.condition === 'new' ? 'accent' : 'neutral'}>{condition}</Badge>
			</span>
		{/if}
	</div>

	<div class="space-y-1 p-3">
		<Price amount={listing.price} class="block" />
		<h3 class="line-clamp-2 text-sm font-medium text-ink">{listing.title}</h3>
		<div class="flex items-center justify-between gap-2 text-xs text-subtle">
			<span class="truncate">{listing.location_area ?? 'Nairobi'}</span>
			<span class="flex-none">{listing.postedLabel}</span>
		</div>
	</div>
</a>
