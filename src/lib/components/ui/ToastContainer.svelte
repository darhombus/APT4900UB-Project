<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { toast, type ToastVariant } from '$lib/toast.svelte';

	// Per-variant icon chip — the same tint + strong-text pairing the badges and
	// alerts use, so toasts read as part of the foundation, not a bolt-on.
	const CHIP: Record<ToastVariant, string> = {
		success: 'bg-success-tint text-success-strong',
		error: 'bg-error-tint text-error-strong',
		warning: 'bg-warning-tint text-warning-strong',
		info: 'bg-brand-tint text-brand-strong'
	};

	// Motion is a whisper here, and skipped entirely under reduced-motion.
	const reduce =
		typeof window !== 'undefined' &&
		!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
	const inMs = reduce ? 0 : 200;
	const outMs = reduce ? 0 : 150;

	/**
	 * Any click anywhere clears the stack.
	 *
	 * A toast is a transient confirmation of something the user just did. Once
	 * their attention has moved on far enough to click something else, it has
	 * served its purpose, and leaving it parked over the page turns dismissal into
	 * a small target to hunt for. The X and the auto-dismiss timer both remain.
	 *
	 * `armedAt` guards one real case. A toast can be raised from inside an event
	 * handler — ImageUploader does exactly that when the chosen files exceed the
	 * limit — and this listener is attached while that same event is still
	 * propagating, so without the guard it would catch the very interaction that
	 * produced the toast and clear it before it could be read. Re-armed on every
	 * change to the stack, because each new toast deserves its own grace period.
	 */
	$effect(() => {
		if (toast.items.length === 0) return;
		const armedAt = Date.now();
		const onDocumentClick = () => {
			if (Date.now() - armedAt < 250) return;
			toast.clear();
		};
		document.addEventListener('click', onDocumentClick);
		return () => document.removeEventListener('click', onDocumentClick);
	});
</script>

{#snippet glyph(variant: ToastVariant)}
	<svg class="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
		{#if variant === 'success'}
			<path
				d="M5 10.5l3.2 3.2L15 7"
				stroke="currentColor"
				stroke-width="1.7"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		{:else if variant === 'warning'}
			<path
				d="M10 3.6l6.6 11.4H3.4z"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linejoin="round"
			/>
			<path d="M10 8.4v3.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
			<circle cx="10" cy="13.8" r="0.5" fill="currentColor" stroke="currentColor" />
		{:else}
			<!-- error + info share a ringed mark; the tint colour carries the meaning -->
			<circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.6" />
			{#if variant === 'error'}
				<path d="M10 6.4v4.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
				<circle cx="10" cy="13.4" r="0.5" fill="currentColor" stroke="currentColor" />
			{:else}
				<path d="M10 9.4v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
				<circle cx="10" cy="6.6" r="0.5" fill="currentColor" stroke="currentColor" />
			{/if}
		{/if}
	</svg>
{/snippet}

<!--
	Rendered once from the root layout. A polite live region announces success/info
	on insertion; individual error toasts escalate to role="alert". Newest sits
	closest to the screen edge via the reversed stack.

	Top-anchored, BELOW the sticky header rather than over it. The offset is not
	cosmetic: the container is pointer-events-none but each toast is
	pointer-events-auto, so a toast sitting on the header would swallow clicks on
	the account menu and the wordmark underneath it for as long as it was visible.
	Two offsets because the header is two rows under `md` (the search row is
	md:hidden) and one row above it.
-->
<div
	class="pointer-events-none fixed inset-x-0 top-28 z-50 flex flex-col-reverse items-center gap-2 px-4 sm:inset-x-auto sm:right-0 sm:items-end sm:px-6 md:top-18"
	aria-live="polite"
	aria-relevant="additions"
>
	{#each toast.items as t (t.id)}
		<div
			role={t.variant === 'error' ? 'alert' : undefined}
			class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border border-border bg-surface p-3 shadow-menu"
			in:fly={{ y: 12, x: reduce ? 0 : 8, duration: inMs }}
			out:fade={{ duration: outMs }}
			onmouseenter={() => toast.pause(t.id)}
			onmouseleave={() => toast.resume(t.id)}
			onfocusin={() => toast.pause(t.id)}
			onfocusout={() => toast.resume(t.id)}
		>
			<span
				class={`flex h-6 w-6 flex-none items-center justify-center rounded-pill ${CHIP[t.variant]}`}
			>
				{@render glyph(t.variant)}
			</span>
			<p class="flex-1 pt-0.5 text-sm text-ink">{t.message}</p>
			<button
				type="button"
				onclick={() => toast.dismiss(t.id)}
				aria-label="Dismiss notification"
				class="-mt-1 -mr-1 flex h-7 w-7 flex-none items-center justify-center rounded-control text-subtle transition-colors hover:bg-page hover:text-ink focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
			>
				<svg class="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
					<path
						d="M6 6l8 8M14 6l-8 8"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
					/>
				</svg>
			</button>
		</div>
	{/each}
</div>
