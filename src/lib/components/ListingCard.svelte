<script lang="ts">
	import { Badge, Price } from '$lib/components/ui';
	import { conditionLabel } from '$lib/validation/listings';
	import type { ListingCardData } from '$lib/listings-view';

	let { listing }: { listing: ListingCardData } = $props();

	const condition = $derived(listing.condition ? conditionLabel(listing.condition) : null);

	// A service listing has no goods photo to show. Rather than a grey placeholder,
	// give it a purpose-built, text-forward card — same footprint as its neighbours
	// so mixed grids stay aligned (services with photos use the standard card below).
	const serviceNoPhoto = $derived(listing.isService && !listing.hasImage);
</script>

<a
	href={`/listings/${listing.id}`}
	class="group block overflow-hidden rounded-card border border-border bg-surface shadow-card transition-shadow hover:shadow-menu focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-page focus-visible:outline-none"
>
	{#if serviceNoPhoto}
		<!-- Service variant: the top region is a designed text panel, not an image. Same
		     aspect ratio + footer as the photo card, so the grid lines up regardless. -->
		<div
			class="relative flex aspect-[4/3] flex-col justify-between overflow-hidden bg-brand-tint/50 p-3.5"
		>
			<!-- Radiating arcs anchored off the bottom-right corner: a service reaches an
			     area. Purely decorative, low-contrast, never a placeholder-image icon. -->
			<svg
				class="pointer-events-none absolute -right-6 -bottom-6 h-28 w-28 text-brand/15"
				viewBox="0 0 100 100"
				fill="none"
				aria-hidden="true"
			>
				<circle cx="100" cy="100" r="24" stroke="currentColor" stroke-width="4" />
				<circle cx="100" cy="100" r="44" stroke="currentColor" stroke-width="4" />
				<circle cx="100" cy="100" r="64" stroke="currentColor" stroke-width="4" />
			</svg>
			<span
				class="relative block truncate text-[11px] font-semibold tracking-wide text-brand-strong uppercase"
			>
				{listing.categoryLabel ?? 'Service'}
			</span>
			<h3 class="relative line-clamp-3 font-display text-base leading-snug font-semibold text-ink">
				{listing.title}
			</h3>
		</div>

		<div class="space-y-1 p-3">
			<Price amount={listing.price} class="block" />
			<div class="flex items-center justify-between gap-2 text-xs text-subtle">
				<span class="truncate">{listing.location_area ?? 'Nairobi'}</span>
				<span class="flex-none">{listing.postedLabel}</span>
			</div>
		</div>
	{:else}
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
	{/if}
</a>
