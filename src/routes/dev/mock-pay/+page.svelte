<script lang="ts">
	import { Alert, Button, Card, Price } from '$lib/components/ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The order stores integer cents (D8); Price takes major units.
	const amount = $derived(data.amountCents / 100);
</script>

<svelte:head>
	<title>Mock payment · MySoko</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="mx-auto max-w-md px-4 py-10">
	<Alert variant="warning" class="mb-4">
		Development stand-in for Paystack's checkout page. This route exists only when
		<code>PAYSTACK_MOCK=1</code> and never on a deployed environment.
	</Alert>

	<Card class="p-6">
		<h1 class="font-display text-xl font-bold text-ink">Confirm payment</h1>
		<p class="mt-1 text-sm text-muted">{data.listingTitle}</p>

		<div class="mt-4 border-t border-border pt-4">
			<div class="flex items-baseline justify-between">
				<span class="text-sm text-muted">Amount</span>
				<Price {amount} size="lg" />
			</div>
			<div class="mt-2 flex items-baseline justify-between">
				<span class="text-sm text-muted">Reference</span>
				<code class="text-xs text-ink">{data.reference}</code>
			</div>
		</div>

		<div class="mt-6 flex flex-col gap-2">
			<form method="POST" action="?/success">
				<input type="hidden" name="reference" value={data.reference} />
				<input type="hidden" name="amountCents" value={data.amountCents} />
				<Button type="submit" class="w-full">Simulate success</Button>
			</form>
			<form method="POST" action="?/failure">
				<input type="hidden" name="reference" value={data.reference} />
				<input type="hidden" name="amountCents" value={data.amountCents} />
				<Button type="submit" variant="destructive" class="w-full">Simulate failure</Button>
			</form>
		</div>
	</Card>
</main>
