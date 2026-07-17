<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Inline feedback banner. Used for form-level success/error/warning messages. */
	type Variant = 'error' | 'success' | 'warning' | 'info';

	interface Props {
		variant?: Variant;
		class?: string;
		children: Snippet;
	}

	let { variant = 'info', class: klass = '', children }: Props = $props();

	const styles: Record<Variant, string> = {
		error: 'border-error/30 bg-error-tint text-error-strong',
		success: 'border-success/30 bg-success-tint text-success-strong',
		warning: 'border-warning/30 bg-warning-tint text-warning-strong',
		info: 'border-brand/30 bg-brand-tint text-brand-strong'
	};
</script>

<div role="alert" class={`rounded-control border p-3 text-sm ${styles[variant]} ${klass}`}>
	{@render children()}
</div>
