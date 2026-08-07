<script lang="ts">
	/**
	 * A person, as a circle: their photo, or their initials on a brand tint when
	 * they have none.
	 *
	 * Extracted when the review list needed the same treatment the listing page's
	 * seller block already had inline. Both now render from here, so an avatar
	 * cannot drift into two shapes.
	 *
	 * Decorative by default: the name is always rendered as text beside it on
	 * every current surface, so an alt would make a screen reader say it twice.
	 */
	interface Props {
		src?: string | null;
		/** Used for the initials fallback. */
		name?: string | null;
		size?: 'sm' | 'md' | 'lg';
		class?: string;
	}

	let { src = null, name = null, size = 'md', class: klass = '' }: Props = $props();

	const box = {
		sm: 'h-9 w-9 text-xs',
		md: 'h-11 w-11 text-sm',
		// For a page whose SUBJECT is the person, where `md` reads as a byline.
		lg: 'h-16 w-16 text-xl'
	} as const;

	function initials(value: string | null | undefined): string {
		if (!value) return '?';
		return (
			value
				.split(/\s+/)
				.filter(Boolean)
				.slice(0, 2)
				.map((w) => w[0]!.toUpperCase())
				.join('') || '?'
		);
	}
</script>

{#if src}
	<img {src} alt="" class={`${box[size]} flex-none rounded-pill object-cover ${klass}`} />
{:else}
	<span
		aria-hidden="true"
		class={`${box[size]} flex flex-none items-center justify-center rounded-pill bg-brand-tint font-semibold text-brand-strong ${klass}`}
	>
		{initials(name)}
	</span>
{/if}
