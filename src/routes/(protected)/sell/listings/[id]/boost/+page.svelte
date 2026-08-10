<script lang="ts">
	import { Alert, Badge, Button, Card, Price } from '$lib/components/ui';
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

	/**
	 * Cost per day, rounded to whole shillings. Shown because it is the only
	 * figure that makes three tiers comparable at a glance — 200/7 and 650/30 are
	 * not numbers anyone divides in their head. It is a comparator, not a
	 * discount claim, so it is set quietly.
	 */
	const perDay = (priceKes: number, days: number) => Math.round(priceKes / days);

	const isBoosted = $derived(data.boostedUntil !== null);
	const canBoost = $derived(data.listing.status === 'active');
</script>

<svelte:head><title>Boost listing · MySoko</title></svelte:head>

<main class="mx-auto max-w-2xl px-4 py-6 sm:py-8">
	<a href="/sell/listings" class="text-sm text-muted underline hover:text-ink">Back to listings</a>

	<h1 class="mt-3 font-display text-2xl font-bold text-ink">Boost this listing</h1>
	<p class="mt-1 text-sm text-muted">{data.listing.title}</p>

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

	<form method="POST" action="?/purchase" class="mt-6">
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
						<span class="flex-1">
							<span class="block font-medium text-ink">{pkg.duration_days} days</span>
							<span class="tnum block text-xs text-subtle">
								KES {perDay(pkg.price_kes, pkg.duration_days)} per day
							</span>
						</span>
						<Price amount={pkg.price_kes} />
					</label>
				{/each}
			</div>

			<Button type="submit" class="mt-5 w-full sm:w-auto">
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
		it's lifted. You pay once — there's no subscription.
	</p>
</main>
