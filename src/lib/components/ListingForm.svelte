<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance, applyAction } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import type { Database } from '$lib/types/database';
	import {
		Badge,
		Button,
		Card,
		Combobox,
		Input,
		Label,
		Select,
		Textarea
	} from '$lib/components/ui';
	import { ImageUploader } from '$lib/components';
	import { toast } from '$lib/toast.svelte';
	import {
		CONDITIONS,
		NAIROBI_AREAS,
		findSubcategory,
		isServiceTop,
		formatThousands,
		draftListingSchema,
		publishListingSchema,
		type CategoryTree
	} from '$lib/validation/listings';
	import { fieldErrors } from '$lib/validation/auth';

	type ListingStatus = Database['public']['Enums']['listing_status'];

	interface ExistingImage {
		id: string;
		storage_path: string;
		position: number;
	}
	interface ListingRow {
		id: string;
		title: string;
		description: string;
		price: number | string;
		category_id: string;
		condition: string | null;
		location_area: string | null;
		status: ListingStatus;
		published_at: string | null;
	}
	interface FormValues {
		title?: string;
		description?: string;
		price?: string;
		categoryId?: string;
		locationArea?: string;
		condition?: string;
	}
	interface FormResult {
		errors?: Record<string, string>;
		formError?: string;
		values?: FormValues;
		success?: boolean;
		id?: string;
		status?: string;
	}

	interface Props {
		supabase: SupabaseClient<Database>;
		sellerId: string;
		categoryTree: CategoryTree[];
		listing?: ListingRow | null;
		images?: ExistingImage[];
		form?: FormResult | null;
	}

	let {
		supabase,
		sellerId,
		categoryTree,
		listing = null,
		images = [],
		form = null
	}: Props = $props();

	// Seed editable state once from props: a failed submit's echoed values first
	// (so a no-JS reload refills), then the loaded listing, then empty. `untrack`
	// documents that we intentionally capture only the initial value (the same
	// pattern the ImageUploader uses for its `initial` prop).
	const initialCategoryId = () => form?.values?.categoryId ?? listing?.category_id ?? '';

	let title = $state(untrack(() => form?.values?.title ?? listing?.title ?? ''));
	let description = $state(untrack(() => form?.values?.description ?? listing?.description ?? ''));
	let priceDisplay = $state(
		untrack(() => {
			const v = form?.values?.price;
			if (v != null) return formatThousands(v);
			return listing ? formatThousands(String(Math.round(Number(listing.price)))) : '';
		})
	);
	let locationArea = $state(
		untrack(() => form?.values?.locationArea ?? listing?.location_area ?? '')
	);
	let condition = $state<string>(
		untrack(() => form?.values?.condition ?? listing?.condition ?? '')
	);
	let selectedSubId = $state(untrack(() => initialCategoryId()));
	let selectedTopId = $state(
		untrack(() => findSubcategory(categoryTree, initialCategoryId())?.top.id ?? '')
	);

	// The row id once it exists — from the loaded listing (edit) or from a draft
	// created lazily on first save (new). A hidden field mirrors it so the action
	// updates rather than inserts.
	let listingId = $state<string | null>(untrack(() => listing?.id ?? form?.id ?? null));
	let photoCount = $state(untrack(() => images.length));

	// Track which button is mid-flight for the loading state.
	let submitting = $state<null | 'draft' | 'publish'>(null);

	const selectedTop = $derived(categoryTree.find((t) => t.id === selectedTopId) ?? null);
	const subOptions = $derived(selectedTop?.children ?? []);
	const isService = $derived(selectedTop ? isServiceTop(selectedTop) : false);

	// A draft (or brand-new) listing offers Save draft + Publish; an already-live
	// row offers a single "Save changes" that never changes its status.
	const isDraftMode = $derived(!listing || listing.status === 'draft');

	// Client validation errors take precedence once a submit is attempted; the
	// server's `form.errors` still drive the no-JS path and any server-only failure.
	let clientErrors = $state<Record<string, string> | null>(null);
	const errors = $derived<Record<string, string>>(clientErrors ?? form?.errors ?? {});

	// When a lazy draft save returns an id, adopt it so the uploader can attach.
	$effect(() => {
		const id = form?.id ?? null;
		if (id && !listingId) listingId = id;
	});

	// Keep the two-step category selects in sync reactively: when the top-level
	// changes, drop a subcategory that no longer belongs to it. Done as an effect
	// rather than an `onchange` handler — a handler spread onto a `bind:value`
	// <select> clobbers the binding's own change listener, so the bound value
	// would never update.
	$effect(() => {
		const validIds = subOptions.map((c) => c.id);
		untrack(() => {
			if (selectedSubId && !validIds.includes(selectedSubId)) selectedSubId = '';
		});
	});

	function onPriceBlur() {
		priceDisplay = formatThousands(priceDisplay);
	}

	// Mirror the server's field validation in the browser so an invalid form never
	// leaves it: the same zod schema + category resolution + publish-goods rules
	// (all pure), over state the component already holds.
	function validateClient(intent: 'draft' | 'publish'): Record<string, string> {
		const raw = {
			title,
			description,
			price: priceDisplay,
			categoryId: selectedSubId,
			locationArea,
			condition
		};
		const schema = intent === 'publish' ? publishListingSchema : draftListingSchema;
		const parsed = schema.safeParse(raw);
		const errs: Record<string, string> = parsed.success ? {} : fieldErrors(parsed.error);

		// The category must resolve to a real subcategory (the client holds the tree).
		const match = selectedSubId ? findSubcategory(categoryTree, selectedSubId) : null;
		if (!match) errs.categoryId ??= selectedSubId ? 'Choose a subcategory' : 'Choose a category';

		// The goods condition + at-least-one-photo publish rules deliberately stay
		// server-side: the photo count mirrors async uploader state, and the server
		// checks the DB authoritatively — so the client sticks to the synchronous,
		// reliable zod schema (which is what the PRD's fast-fail is about).
		return errs;
	}

	// Field ids in visual order, so focus lands on the first invalid one.
	const FOCUS_ID: Record<string, string> = {
		title: 'title',
		categoryId: 'categoryId',
		condition: 'condition',
		price: 'price',
		description: 'description',
		locationArea: 'location'
	};
	const FIELD_ORDER = ['title', 'categoryId', 'condition', 'price', 'description', 'locationArea'];
	function focusFirstError(errs: Record<string, string>) {
		for (const key of FIELD_ORDER) {
			if (!errs[key]) continue;
			const el = document.getElementById(FOCUS_ID[key]);
			if (el instanceof HTMLElement) {
				el.focus({ preventScroll: true });
				el.scrollIntoView({ block: 'center' });
			}
			return;
		}
	}

	const submit: SubmitFunction = ({ action, cancel }) => {
		const intent = action.search.includes('saveDraft') ? 'draft' : 'publish';

		// Fast-fail: an invalid form never leaves the browser — render inline errors
		// immediately and move focus to the first invalid field.
		const errs = validateClient(intent);
		if (Object.keys(errs).length > 0) {
			clientErrors = errs;
			focusFirstError(errs);
			cancel();
			return;
		}
		// Passed the client checks — defer to the server for any residual field error
		// (e.g. the goods photo rule), which then shows via `form.errors`.
		clientErrors = null;

		submitting = intent;
		return async ({ result }) => {
			// Outcome feedback as a toast; field errors stay inline via applyAction,
			// which updates `form` (and follows a redirect) without resetting the
			// seller's entered fields — progressive enhancement over the native POST.
			if (result.type === 'redirect') {
				toast.success(isDraftMode ? 'Listing published' : 'Changes saved');
			} else if (result.type === 'success') {
				const status = (result.data as { status?: string } | undefined)?.status;
				toast.success(status === 'draft' ? 'Draft saved' : 'Changes saved');
			} else if (result.type === 'failure') {
				const message = (result.data as { formError?: string } | undefined)?.formError;
				if (message) toast.error(message);
			}
			await applyAction(result);
			submitting = null;
		};
	};
</script>

<main class="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:py-10">
	<div class="flex items-center justify-between gap-3">
		<div>
			<h1 class="font-display text-2xl font-bold text-ink">
				{listing ? 'Edit listing' : 'New listing'}
			</h1>
			<p class="mt-1 text-sm text-muted">
				{isDraftMode
					? 'Save a draft any time, or publish when it’s ready.'
					: 'Your changes go live as soon as you save.'}
			</p>
		</div>
		{#if listing}
			<Badge variant={listing.status}><span class="capitalize">{listing.status}</span></Badge>
		{/if}
	</div>

	<form method="POST" action="?/saveDraft" use:enhance={submit} class="space-y-6">
		<input type="hidden" name="listingId" value={listingId ?? ''} />

		<!-- ── Details ──────────────────────────────────────────────────────── -->
		<Card class="space-y-4">
			<div>
				<Label for="title">Title</Label>
				<Input
					id="title"
					name="title"
					bind:value={title}
					maxlength={120}
					placeholder="e.g. iPhone 12, 128GB, excellent condition"
					error={errors.title}
				/>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<Label for="category-top">Category</Label>
					<Select id="category-top" bind:value={selectedTopId} placeholder="Choose a category">
						{#each categoryTree as top (top.id)}
							<option value={top.id}>{top.name}</option>
						{/each}
					</Select>
				</div>
				<div>
					<Label for="categoryId">Subcategory</Label>
					<Select
						id="categoryId"
						name="categoryId"
						bind:value={selectedSubId}
						disabled={!selectedTop}
						error={errors.categoryId}
						placeholder={selectedTop ? 'Choose a subcategory' : 'Pick a category first'}
					>
						{#each subOptions as sub (sub.id)}
							<option value={sub.id}>{sub.name}</option>
						{/each}
					</Select>
				</div>
			</div>

			{#if selectedTop && !isService}
				<div>
					<Label for="condition">Condition</Label>
					<Select
						id="condition"
						name="condition"
						bind:value={condition}
						error={errors.condition}
						placeholder="Choose condition"
					>
						{#each CONDITIONS as c (c.value)}
							<option value={c.value}>{c.label}</option>
						{/each}
					</Select>
				</div>
			{/if}

			<div>
				<Label for="price">Price (KSh)</Label>
				<Input
					id="price"
					name="price"
					inputmode="numeric"
					bind:value={priceDisplay}
					onblur={onPriceBlur}
					placeholder="e.g. 2500"
					error={errors.price}
				/>
			</div>

			<div>
				<Label for="description">Description</Label>
				<Textarea
					id="description"
					name="description"
					rows={6}
					bind:value={description}
					maxlength={5000}
					placeholder="Describe what you’re selling — condition, features, what’s included. Required to publish."
					error={errors.description}
				/>
			</div>

			<div>
				<Label for="location" optional>Location</Label>
				<Combobox
					id="location"
					name="locationArea"
					options={NAIROBI_AREAS}
					bind:value={locationArea}
					placeholder="e.g. Westlands"
					error={errors.locationArea}
				/>
			</div>
		</Card>

		<!-- ── Photos ───────────────────────────────────────────────────────── -->
		<Card class="space-y-3">
			<div class="flex items-baseline justify-between">
				<h2 class="text-lg font-semibold text-ink">Photos</h2>
				{#if !isService}
					<span class="text-xs text-subtle">Required to publish</span>
				{/if}
			</div>

			{#if listingId}
				<ImageUploader
					{supabase}
					{listingId}
					{sellerId}
					initial={images}
					onchange={(n) => (photoCount = n)}
				/>
			{:else}
				<button
					type="submit"
					formaction="?/saveDraft"
					class="flex w-full flex-col items-center justify-center gap-1.5 rounded-card border-2 border-dashed border-border py-8 text-subtle transition-colors hover:border-brand hover:text-brand focus-visible:border-brand focus-visible:text-brand focus-visible:outline-none"
				>
					<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path
							d="M12 5v14M5 12h14"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
						/>
					</svg>
					<span class="text-sm font-medium">Save a draft to add photos</span>
				</button>
				<p class="text-xs text-subtle">
					We’ll save your details as a draft first, then you can upload up to 6 photos.
				</p>
			{/if}

			{#if errors.images}
				<p class="text-sm text-error">{errors.images}</p>
			{/if}
			{#if !isService && listingId && photoCount === 0}
				<p class="text-xs text-subtle">Add at least one photo to publish.</p>
			{/if}
		</Card>

		<!-- ── Actions ──────────────────────────────────────────────────────── -->
		<div class="flex flex-wrap items-center gap-3">
			{#if isDraftMode}
				<Button
					type="submit"
					formaction="?/publish"
					loading={submitting === 'publish'}
					disabled={!!submitting}
				>
					Publish
				</Button>
				<Button
					type="submit"
					formaction="?/saveDraft"
					variant="secondary"
					loading={submitting === 'draft'}
					disabled={!!submitting}
				>
					Save draft
				</Button>
			{:else}
				<Button
					type="submit"
					formaction="?/publish"
					loading={submitting === 'publish'}
					disabled={!!submitting}
				>
					Save changes
				</Button>
			{/if}
			<a href="/sell/listings" class="text-sm font-medium text-muted hover:text-ink">Cancel</a>
		</div>
	</form>
</main>
