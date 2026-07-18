<script lang="ts">
	import { untrack } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import type { Database } from '$lib/types/database';
	import { Badge } from '$lib/components/ui';
	import { toast } from '$lib/toast.svelte';
	import { validateImageFile, compressToWebp } from '$lib/images';
	import { buildImagePath, publicUrl, LISTING_IMAGES_BUCKET } from '$lib/listing-images';

	interface ExistingImage {
		id: string;
		storage_path: string;
		position: number;
	}

	interface UploaderImage {
		key: string; // stable client key for reactive updates across async work
		id: string | null; // listing_images row id (null while uploading)
		storage_path: string;
		position: number;
		url: string;
		status: 'ready' | 'uploading' | 'error';
		error?: string;
		objectUrl?: string; // local preview to revoke once uploaded
	}

	interface Props {
		supabase: SupabaseClient<Database>;
		listingId: string;
		sellerId: string;
		initial?: ExistingImage[];
		max?: number;
		/** Fired with the count of successfully-stored photos after any change. */
		onchange?: (readyCount: number) => void;
	}

	let { supabase, listingId, sellerId, initial = [], max = 6, onchange }: Props = $props();

	// Seed once from the `initial` prop (existing photos in edit mode); `untrack`
	// documents that we intentionally capture only its initial value.
	let images = $state<UploaderImage[]>(
		untrack(() =>
			[...initial]
				.sort((a, b) => a.position - b.position)
				.map((img) => ({
					key: crypto.randomUUID(),
					id: img.id,
					storage_path: img.storage_path,
					position: img.position,
					url: publicUrl(supabase, img.storage_path),
					status: 'ready' as const
				}))
		)
	);
	const ctrl =
		'flex h-7 w-7 items-center justify-center rounded-control text-white transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-transparent';

	function notify() {
		onchange?.(images.filter((i) => i.status === 'ready').length);
	}

	function patch(key: string, next: Partial<UploaderImage>) {
		const idx = images.findIndex((i) => i.key === key);
		if (idx >= 0) Object.assign(images[idx], next);
	}

	async function onPick(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const picked = Array.from(input.files ?? []);
		input.value = ''; // let the same file be re-picked later
		if (picked.length === 0) return;

		const remaining = max - images.length;
		if (remaining <= 0) {
			toast.warning(`You can add up to ${max} photos.`);
			return;
		}
		const toAdd = picked.slice(0, remaining);
		if (picked.length > remaining) {
			toast.warning(`You can add up to ${max} photos — kept the first ${remaining}.`);
		}

		for (const file of toAdd) {
			const check = validateImageFile(file);
			if (!check.ok) {
				toast.warning(check.error);
				continue;
			}
			await uploadOne(file);
		}
	}

	async function uploadOne(file: File) {
		const key = crypto.randomUUID();
		const objectUrl = URL.createObjectURL(file);
		const position = images.length;
		images.push({
			key,
			id: null,
			storage_path: '',
			position,
			url: objectUrl,
			status: 'uploading',
			objectUrl
		});

		try {
			const blob = await compressToWebp(file);
			const path = buildImagePath(sellerId, listingId, crypto.randomUUID());

			const { error: upErr } = await supabase.storage
				.from(LISTING_IMAGES_BUCKET)
				.upload(path, blob, { contentType: 'image/webp', upsert: false });
			if (upErr) throw upErr;

			const { data: row, error: rowErr } = await supabase
				.from('listing_images')
				.insert({ listing_id: listingId, storage_path: path, position })
				.select('id')
				.single();
			if (rowErr) {
				// Roll back the now-orphaned storage object.
				await supabase.storage.from(LISTING_IMAGES_BUCKET).remove([path]);
				throw rowErr;
			}

			URL.revokeObjectURL(objectUrl);
			patch(key, {
				id: row.id,
				storage_path: path,
				url: publicUrl(supabase, path),
				status: 'ready',
				objectUrl: undefined
			});
		} catch (e) {
			patch(key, { status: 'error', error: e instanceof Error ? e.message : 'Upload failed.' });
		}
		notify();
	}

	async function removeImage(index: number) {
		const item = images[index];
		if (item.storage_path) {
			await supabase.storage.from(LISTING_IMAGES_BUCKET).remove([item.storage_path]);
		}
		if (item.id) {
			await supabase.from('listing_images').delete().eq('id', item.id);
		}
		if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
		images.splice(index, 1);
		await persistOrder();
		notify();
	}

	async function move(index: number, delta: number) {
		const target = index + delta;
		if (target < 0 || target >= images.length) return;
		const a = images[index];
		images[index] = images[target];
		images[target] = a;
		await persistOrder();
	}

	/**
	 * Reindex persisted rows to match display order. Two-phase — park every row at a
	 * unique negative position, then assign 0..n-1 — so the UNIQUE(listing_id,
	 * position) constraint is never violated mid-reorder. Sequential for the same reason.
	 */
	async function persistOrder() {
		for (let i = 0; i < images.length; i++) {
			const img = images[i];
			if (img.id)
				await supabase
					.from('listing_images')
					.update({ position: -(i + 1) })
					.eq('id', img.id);
		}
		for (let i = 0; i < images.length; i++) {
			const img = images[i];
			img.position = i;
			if (img.id) await supabase.from('listing_images').update({ position: i }).eq('id', img.id);
		}
	}
</script>

<div class="space-y-3">
	<div class="grid grid-cols-3 gap-3 sm:grid-cols-4">
		{#each images as img, i (img.key)}
			<div
				class="relative aspect-square overflow-hidden rounded-card border border-border bg-neutral-tint"
			>
				<img src={img.url} alt={`Listing photo ${i + 1}`} class="h-full w-full object-cover" />

				{#if i === 0 && img.status === 'ready'}
					<span class="absolute top-1.5 left-1.5"><Badge variant="brand">Cover</Badge></span>
				{/if}

				{#if img.status === 'uploading'}
					<div class="absolute inset-0 flex items-center justify-center bg-ink/40">
						<svg
							class="h-6 w-6 animate-spin text-white"
							viewBox="0 0 24 24"
							fill="none"
							aria-hidden="true"
						>
							<circle
								class="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								stroke-width="4"
							/>
							<path
								class="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
							/>
						</svg>
						<span class="sr-only">Uploading…</span>
					</div>
				{:else if img.status === 'error'}
					<div
						class="absolute inset-0 flex items-center justify-center bg-error/85 p-2 text-center"
					>
						<span class="text-xs font-medium text-white">{img.error ?? 'Upload failed'}</span>
					</div>
				{/if}

				{#if img.status !== 'uploading'}
					<div
						class="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-ink/55 p-1"
					>
						<div class="flex gap-1">
							<button
								type="button"
								class={ctrl}
								disabled={i === 0}
								onclick={() => move(i, -1)}
								aria-label="Move photo left"
							>
								<svg class="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
									<path
										d="M12 5l-5 5 5 5"
										stroke="currentColor"
										stroke-width="1.6"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
								</svg>
							</button>
							<button
								type="button"
								class={ctrl}
								disabled={i === images.length - 1}
								onclick={() => move(i, 1)}
								aria-label="Move photo right"
							>
								<svg class="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
									<path
										d="M8 5l5 5-5 5"
										stroke="currentColor"
										stroke-width="1.6"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
								</svg>
							</button>
						</div>
						<button
							type="button"
							class={ctrl}
							onclick={() => removeImage(i)}
							aria-label="Remove photo"
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
				{/if}
			</div>
		{/each}

		{#if images.length < max}
			<label
				class="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed border-border text-subtle transition-colors hover:border-brand hover:text-brand focus-within:border-brand focus-within:text-brand"
			>
				<input
					type="file"
					accept="image/jpeg,image/png,image/webp"
					multiple
					class="sr-only"
					onchange={onPick}
				/>
				<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<path
						d="M12 5v14M5 12h14"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
					/>
				</svg>
				<span class="text-xs font-medium">Add</span>
			</label>
		{/if}
	</div>

	<p class="text-xs text-subtle">
		Up to {max} photos. The first photo is your cover; use the arrows to reorder.
	</p>
</div>
