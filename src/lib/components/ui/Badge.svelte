<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Generic tones plus the listing-status set. Status aliases map onto the
	 * palette so draft/active/paused/sold/removed stay consistent everywhere.
	 */
	type Variant =
		| 'neutral'
		| 'brand'
		| 'accent'
		| 'success'
		| 'warning'
		| 'error'
		| 'draft'
		| 'active'
		| 'paused'
		| 'sold'
		| 'removed'
		| 'deleted';

	interface Props {
		variant?: Variant;
		class?: string;
		children: Snippet;
	}

	let { variant = 'neutral', class: klass = '', children }: Props = $props();

	const styles: Record<Variant, string> = {
		neutral: 'bg-neutral-tint text-neutral-strong',
		brand: 'bg-brand-tint text-brand-strong',
		accent: 'bg-accent-tint text-accent-strong',
		success: 'bg-success-tint text-success-strong',
		warning: 'bg-warning-tint text-warning-strong',
		error: 'bg-error-tint text-error-strong',
		// Listing statuses
		draft: 'bg-neutral-tint text-neutral-strong',
		active: 'bg-success-tint text-success-strong',
		paused: 'bg-accent-tint text-accent-strong',
		sold: 'bg-ink text-white',
		removed: 'bg-error-tint text-error-strong',
		// A deleted listing is never rendered (RLS hides it); a muted fallback tone.
		deleted: 'bg-neutral-tint text-subtle'
	};
</script>

<span
	class={`inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs font-semibold ${styles[variant]} ${klass}`}
>
	{@render children()}
</span>
