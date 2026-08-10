<script lang="ts">
	import { enhance } from '$app/forms';
	import { Alert, Badge, Button, Card, Price } from '$lib/components/ui';
	import { notifyFromResult } from '$lib/toast.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Longest tier preselected — best value per day, and a picker with nothing
	// chosen makes the submit button a dead end until you notice why.
	//
	// The default is DERIVED rather than seeded into $state: seeding would capture
	// only the first render's packages, so a tier retired between navigations would
	// leave a stale id selected. `chosen` holds the seller's explicit pick and
	// nothing else.
	let chosen = $state('');
	const packageId = $derived(chosen || (data.packages.at(-1)?.id ?? ''));

	const dateFmt = new Intl.DateTimeFormat('en-KE', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});

	const isBoosted = $derived(data.boostedUntil !== null);
	const canBoost = $derived(data.listing.status === 'active');

	/**
	 * Hand the seller to Paystack, and surface a failure as a toast.
	 *
	 * The redirect branch is not optional. `enhance` resolves redirects with
	 * `goto()`, which refuses EXTERNAL urls — Paystack's hosted page is external,
	 * so without this the handoff silently dies on the JS path. Copied from the
	 * checkout `onBuy` handler, which solved the same problem (D2). Without JS the
	 * native POST follows the 303 itself, so both paths land in the same place.
	 *
	 * `buying` is deliberately left true on handoff, so the button keeps its
	 * pending state right up to the navigation rather than flicking back.
	 */
	let buying = $state(false);
	const onPurchase: SubmitFunction = () => {
		buying = true;
		return async ({ result, update }) => {
			if (result.type === 'redirect') {
				window.location.assign(result.location);
				return;
			}
			await update();
			// Action-level outcomes are toasts, not inline text — the convention in
			// $lib/toast.svelte. The Alert below is the no-JS path's only option.
			if (result.type === 'failure') notifyFromResult(result);
			buying = false;
		};
	};
</script>

<svelte:head><title>Boost listing · MySoko</title></svelte:head>

<main class="mx-auto max-w-2xl px-4 py-6 sm:py-8">
	<a href="/sell/listings" class="text-sm text-muted underline hover:text-ink">Back to listings</a>

	<h1 class="mt-3 font-display text-2xl font-bold text-ink">Boost this listing</h1>
	<p class="mt-1 text-sm text-muted">{data.listing.title}</p>

	<!-- No-JS fallback only. On the JS path `onPurchase` fires a toast and this
	     never renders, so a failure is never reported twice. -->
	{#if form?.formError}
		<Alert variant="error" class="mt-6">{form.formError}</Alert>
	{/if}

	{#if !canBoost}
		<!-- An inactive listing cannot be boosted (BST-4). Say which state blocks it
		     and what to do, rather than only disabling the button. -->
		<Alert variant="warning" class="mt-6">
			Only an active listing can be boosted. Publish this listing first, then come back.
		</Alert>
	{/if}

	{#if isBoosted}
		<Card class="mt-6">
			<div class="flex items-center gap-2">
				<Badge variant="featured">Featured</Badge>
				<p class="text-sm font-medium text-ink">Boost running</p>
			</div>
			<p class="mt-2 text-sm text-muted">
				This listing appears above others in search and category results until
				<span class="font-medium text-ink">{dateFmt.format(new Date(data.boostedUntil!))}</span>.
				Buying another package adds its days to that date — boosts extend, they don't stack.
			</p>
		</Card>
	{/if}

	<form method="POST" action="?/purchase" use:enhance={onPurchase} class="mt-6">
		<fieldset disabled={!canBoost}>
			<legend class="font-display text-base font-semibold text-ink">
				{isBoosted ? 'Add more days' : 'Choose a package'}
			</legend>

			<div class="mt-3 space-y-2">
				{#each data.packages as pkg (pkg.id)}
					<label
						class="flex cursor-pointer items-center gap-3 rounded-card border bg-surface p-4 transition-colors
							{packageId === pkg.id ? 'border-brand bg-brand-tint/40' : 'border-border hover:border-brand/40'}"
					>
						<input
							type="radio"
							name="packageId"
							value={pkg.id}
							checked={packageId === pkg.id}
							onchange={() => (chosen = pkg.id)}
							class="h-4 w-4 flex-none accent-brand focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:outline-none"
						/>
						<span class="flex-1 font-medium text-ink">{pkg.duration_days} days</span>
						<Price amount={pkg.price_kes} />
					</label>
				{/each}
			</div>

			<!-- The per-day figure that used to sit under each tier is gone. On a
			     payment surface "KES 29 per day" reads as a billing rate, and a
			     recurring charge is the one thing BST-2 forbids. The one-time fact is
			     stated here instead — beside the decision, not below the button. -->
			<p class="mt-4 text-sm text-muted">
				One payment. Your boost runs for the full period, then stops.
			</p>

			<Button type="submit" loading={buying} disabled={buying} class="mt-3 w-full sm:w-auto">
				{isBoosted ? 'Extend boost' : 'Boost listing'}
			</Button>
		</fieldset>
	</form>

	<!-- BST-6 in the seller's own words: they are buying position, not visibility,
	     and buyers will see that it was paid for. Stating both up front is the
	     honest version of a disclosure requirement. -->
	<p class="mt-4 text-xs text-subtle">
		A boost lifts this listing above others in search and category results it already matches. It
		never adds your listing to searches it doesn't match, and it carries a Featured badge wherever
		it's lifted.
	</p>
</main>
