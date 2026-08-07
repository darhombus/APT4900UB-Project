<script lang="ts">
	import { formatAverage, ratingFillPercent, ratingLabel } from '$lib/reviews';

	/**
	 * Read-only star rating. Two stacked rows of the same five stars — an empty
	 * row underneath, a filled row on top clipped to a percentage width — so a 4.6
	 * renders as four and a bit stars with no half-star assets and no JavaScript
	 * (Reviews PRD Section 7.6). Pure CSS/SVG: it renders identically before
	 * hydration and with scripting off.
	 *
	 * Amber rather than brand green is deliberate. The theme reserves green for
	 * ACTION and amber for non-action emphasis; a rating is neither a button nor a
	 * status, and a green star would read as something you can press.
	 */
	interface Props {
		/** Plain average, 1–5. Null renders nothing — callers handle the empty state. */
		average: number | null;
		/** Shown beside the stars when present. */
		count?: number | null;
		size?: 'sm' | 'md';
		/** Render the numeric average beside the stars. */
		showValue?: boolean;
		/**
		 * Names what is being rated, for the accessible label — "Seller",
		 * "This listing", or a reviewer's name. A page can carry several ratings
		 * that a sighted reader separates by placement; a screen reader gets no
		 * such cue, so pass this wherever more than one rating is in play.
		 */
		subject?: string;
		class?: string;
	}

	let {
		average,
		count = null,
		size = 'sm',
		showValue = true,
		subject,
		class: klass = ''
	}: Props = $props();

	const star = {
		sm: 'h-3.5 w-3.5',
		md: 'h-[1.125rem] w-[1.125rem]'
	} as const;

	const text = {
		sm: 'text-xs',
		md: 'text-sm'
	} as const;

	const fill = $derived(average === null ? 0 : ratingFillPercent(average));
</script>

{#if average !== null}
	<span class={`inline-flex items-center gap-1.5 ${klass}`}>
		<!-- The stars themselves are decorative; the accessible name is on the
		     wrapper, so a screen reader says "Rated 4.6 out of 5" once rather than
		     announcing ten SVGs. -->
		<span class="relative inline-flex" aria-label={ratingLabel(average, subject)} role="img">
			<span class="inline-flex text-border" aria-hidden="true">
				{#each [0, 1, 2, 3, 4] as i (i)}
					<svg class={star[size]} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
						<path
							d="M10 1.6l2.47 5.28 5.53.72-4.07 3.9 1.04 5.66L10 14.4l-4.97 2.76 1.04-5.66L2 7.6l5.53-.72L10 1.6z"
						/>
					</svg>
				{/each}
			</span>
			<!-- Clipped overlay. The inner row keeps its natural full width; the
			     absolutely-positioned parent is what narrows, so the stars are cut
			     rather than squashed.
			     `flex` is load-bearing, not decoration. Absolute positioning makes
			     this a BLOCK container, so an inline-level child would sit in a line
			     box and take the root line-height's half-leading — dropping the gold
			     row a pixel or two below the grey row underneath it and leaving the
			     empty stars visibly peeking out above. As a flex container there is
			     no line box, so the child aligns flush at the top and the two rows
			     register exactly. -->
			<span
				class="absolute top-0 left-0 flex overflow-hidden text-accent"
				style={`width: ${fill}%`}
				aria-hidden="true"
			>
				<span class="inline-flex">
					{#each [0, 1, 2, 3, 4] as i (i)}
						<svg class={star[size]} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
							<path
								d="M10 1.6l2.47 5.28 5.53.72-4.07 3.9 1.04 5.66L10 14.4l-4.97 2.76 1.04-5.66L2 7.6l5.53-.72L10 1.6z"
							/>
						</svg>
					{/each}
				</span>
			</span>
		</span>

		{#if showValue}
			<span class={`tnum font-medium text-ink ${text[size]}`}>{formatAverage(average)}</span>
		{/if}
		{#if count !== null}
			<span class={`tnum text-subtle ${text[size]}`}>({count})</span>
		{/if}
	</span>
{/if}
