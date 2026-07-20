<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	/**
	 * Editable combobox (WAI-ARIA combobox + listbox pattern) with filter-as-you-type
	 * over a suggestion list. Free text is allowed — the input's value is what
	 * submits — so it's a drop-in for a native <input list> datalist while fixing the
	 * datalist's inconsistent open/reopen behaviour. Reusable: pass `options` and the
	 * usual input attributes (name, id, placeholder).
	 */
	interface Props extends Omit<HTMLInputAttributes, 'value' | 'list'> {
		value?: string;
		/** Suggestion list. */
		options: readonly string[];
		/** Field error message; renders below and flags the control invalid. */
		error?: string;
		class?: string;
	}

	let { value = $bindable(''), options, error, class: klass = '', id, ...rest }: Props = $props();

	const listId = $derived(id ? `${id}-listbox` : 'combobox-listbox');
	const errorId = $derived(error && id ? `${id}-error` : undefined);
	const optId = (i: number) => `${listId}-opt-${i}`;

	let open = $state(false);
	let active = $state(-1);
	// We only filter once the user starts typing; opening via click/arrow shows the
	// FULL list (so a prior selection never collapses it to a single item).
	let filtering = $state(false);
	let root: HTMLDivElement;
	let input: HTMLInputElement | undefined = $state();

	const filtered = $derived.by(() => {
		const q = value.trim().toLowerCase();
		if (!filtering || q === '') return options;
		return options.filter((o) => o.toLowerCase().includes(q));
	});

	/** Open showing the full list, highlighting the current selection if present. */
	function reveal() {
		filtering = false;
		open = true;
		active = options.findIndex((o) => o === value);
		input?.focus();
	}

	function close() {
		open = false;
		active = -1;
	}

	function choose(option: string) {
		value = option;
		filtering = false;
		close();
		input?.focus();
	}

	function clear() {
		value = '';
		reveal();
	}

	function onInput() {
		filtering = true;
		open = true;
		active = 0;
	}

	function onKeydown(event: KeyboardEvent) {
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				if (!open) return reveal();
				active = Math.min(active + 1, filtered.length - 1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				if (!open) return reveal();
				active = Math.max(active - 1, 0);
				break;
			case 'Enter':
				if (open && active >= 0 && active < filtered.length) {
					event.preventDefault();
					choose(filtered[active]!);
				}
				break;
			case 'Escape':
				if (open) {
					event.preventDefault();
					close();
				}
				break;
			case 'Tab':
				// Commit a highlighted option, then let focus move on.
				if (open && active >= 0 && active < filtered.length) value = filtered[active]!;
				close();
				break;
		}
	}

	// Close when focus leaves the whole component (blur or outside click).
	function onFocusout(event: FocusEvent) {
		if (!root.contains(event.relatedTarget as Node | null)) close();
	}
</script>

<div class="relative" bind:this={root} onfocusout={onFocusout}>
	<input
		bind:this={input}
		bind:value
		{id}
		{...rest}
		role="combobox"
		aria-expanded={open}
		aria-controls={listId}
		aria-autocomplete="list"
		aria-activedescendant={open && active >= 0 && active < filtered.length
			? optId(active)
			: undefined}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={errorId}
		autocomplete="off"
		class={`block h-11 w-full rounded-control border bg-surface pr-16 pl-3 text-sm text-ink placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 focus:ring-brand/30 ${error ? 'border-error focus:border-error focus:ring-error/30' : 'border-border focus:border-brand'} ${klass}`}
		onclick={() => {
			if (!open) reveal();
		}}
		oninput={onInput}
		onkeydown={onKeydown}
	/>

	<div class="absolute top-1/2 right-1 flex -translate-y-1/2 items-center">
		{#if value}
			<button
				type="button"
				onmousedown={(e) => e.preventDefault()}
				onclick={clear}
				aria-label="Clear"
				class="flex h-8 w-8 items-center justify-center rounded-control text-subtle transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
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
		{/if}
		<button
			type="button"
			tabindex="-1"
			onmousedown={(e) => e.preventDefault()}
			onclick={() => (open ? close() : reveal())}
			aria-label={open ? 'Close suggestions' : 'Show suggestions'}
			class="flex h-8 w-8 items-center justify-center rounded-control text-subtle transition-colors hover:text-ink"
		>
			<svg
				class={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
				viewBox="0 0 20 20"
				fill="none"
				aria-hidden="true"
			>
				<path
					d="M6 8l4 4 4-4"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>
	</div>

	{#if open && filtered.length > 0}
		<ul
			id={listId}
			role="listbox"
			class="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-card border border-border bg-surface p-1 shadow-menu"
		>
			{#each filtered as option, i (option)}
				<!-- Keyboard selection is handled centrally on the input (arrows +
				     aria-activedescendant + Enter), the WAI-ARIA combobox pattern; options
				     aren't individually focusable, so a per-option key handler is wrong. -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id={optId(i)}
					role="option"
					aria-selected={option === value}
					onmousedown={(e) => e.preventDefault()}
					onclick={() => choose(option)}
					onmousemove={() => (active = i)}
					class={`flex cursor-pointer items-center justify-between rounded-control px-3 py-2 text-sm ${
						i === active ? 'bg-brand-tint text-brand-strong' : 'text-ink'
					}`}
				>
					{option}
					{#if option === value}
						<svg class="h-4 w-4 text-brand" viewBox="0 0 20 20" fill="none" aria-hidden="true">
							<path
								d="M5 10.5l3.2 3.2L15 7"
								stroke="currentColor"
								stroke-width="1.7"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
{#if error}
	<p id={errorId} class="mt-1 text-sm text-error">{error}</p>
{/if}
