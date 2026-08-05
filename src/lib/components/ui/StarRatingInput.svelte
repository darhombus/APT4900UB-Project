<script lang="ts">
	import { RATING_LABELS, RATING_VALUES } from '$lib/reviews';

	/**
	 * Rating picker: five real radio inputs (D12).
	 *
	 * Not a JS widget. The radios are the control — visually hidden but focusable,
	 * so the whole thing arrives working before hydration and keeps working with
	 * scripting off. Keyboard behaviour is the browser's own radiogroup handling
	 * (arrow keys move and select, Tab enters and leaves the group), which is
	 * better than anything re-implemented here.
	 *
	 * The hover/checked fill is pure CSS sibling selection: `:checked ~ label`
	 * cannot reach backwards, so the row is laid out in REVERSE DOM order (5 → 1)
	 * and flipped with `flex-row-reverse`. A star lights when it or any star to
	 * its right in the DOM — i.e. any LOWER value on screen — is checked.
	 */
	interface Props {
		name?: string;
		/** Pre-selected value, e.g. when re-rendering after a failed submit. */
		value?: number | null;
		required?: boolean;
		/** Flags the group invalid and renders the message below. */
		error?: string;
		id?: string;
	}

	let { name = 'rating', value = null, required = true, error, id = 'rating' }: Props = $props();

	const errorId = $derived(error ? `${id}-error` : undefined);
	// Highest first: the CSS below relies on this order to fill leftwards.
	const descending = [...RATING_VALUES].reverse();
</script>

<!-- role="radiogroup" rather than the implicit `group`: a fieldset's implicit role
     does not support aria-invalid, and this IS a radiogroup — the explicit role
     both names it accurately and lets the invalid state be announced. -->
<fieldset role="radiogroup" aria-describedby={errorId} aria-invalid={error ? 'true' : undefined}>
	<legend class="sr-only">Rating, 1 to 5 stars</legend>

	<div class="star-row flex flex-row-reverse justify-end">
		{#each descending as v (v)}
			<input
				class="peer sr-only"
				type="radio"
				id={`${id}-${v}`}
				{name}
				value={v}
				{required}
				checked={value === v}
			/>
			<label
				for={`${id}-${v}`}
				title={`${v} — ${RATING_LABELS[v]}`}
				class="cursor-pointer rounded-control p-0.5 text-border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40"
			>
				<span class="sr-only">{v} {v === 1 ? 'star' : 'stars'} — {RATING_LABELS[v]}</span>
				<svg class="h-8 w-8" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
					<path
						d="M10 1.6l2.47 5.28 5.53.72-4.07 3.9 1.04 5.66L10 14.4l-4.97 2.76 1.04-5.66L2 7.6l5.53-.72L10 1.6z"
					/>
				</svg>
			</label>
		{/each}
	</div>

	{#if error}
		<p id={errorId} class="mt-1 text-sm text-error">{error}</p>
	{/if}
</fieldset>

<style>
	/* A checked radio fills its own star and every star after it in the DOM —
	   which, because the row is reversed, is every star to its LEFT on screen.
	   Hover previews the same shape. Written as plain CSS rather than Tailwind
	   because `:has()` and multi-step sibling combinators are what make this work
	   without JavaScript. */
	.star-row input:checked ~ label,
	.star-row label:hover,
	.star-row label:hover ~ label {
		color: var(--color-accent);
	}

	/* Hovering anywhere in the row must not leave the previously-checked stars
	   lit to the right of the cursor, or the preview reads as a higher rating
	   than the pointer is over. */
	.star-row:hover input:checked ~ label {
		color: var(--color-border);
	}
	.star-row:hover label:hover,
	.star-row:hover label:hover ~ label {
		color: var(--color-accent);
	}

	@media (prefers-reduced-motion: reduce) {
		.star-row label {
			transition: none;
		}
	}
</style>
