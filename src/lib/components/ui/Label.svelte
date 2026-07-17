<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Associates the label with a control via the control's id. */
		for?: string;
		/** Appends a muted "(optional)" hint. */
		optional?: boolean;
		class?: string;
		children: Snippet;
	}

	let { for: htmlFor, optional = false, class: klass = '', children }: Props = $props();
</script>

<label for={htmlFor} class={`mb-1 block text-sm font-medium text-ink ${klass}`}>
	{@render children()}
	{#if optional}<span class="font-normal text-subtle">(optional)</span>{/if}
</label>
