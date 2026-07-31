<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { Alert, Badge, Button, Card, Input, Label, Price } from '$lib/components/ui';
	import { centsToMajor } from '$lib/orders';
	import { payoutOriginLabel, payoutStatusLabel, payoutStatusVariant } from '$lib/payouts';
	import { toast } from '$lib/toast.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/**
	 * Outcomes are toasts; field-level errors stay inline as an Alert, per the
	 * convention in $lib/toast.svelte.
	 *
	 * Both actions REDIRECT on success (post-redirect-get, so a refresh cannot
	 * re-submit), which is why this uses applyAction rather than update — update
	 * does not follow a redirect result. Progressive enhancement is intact: with
	 * JS off the form is a plain POST, the server still redirects, and the page
	 * shows the new state. Only the toast is lost, and the state itself is the
	 * confirmation.
	 */
	function toastOnSuccess(message: string): SubmitFunction {
		return () =>
			async ({ result }) => {
				if (result.type === 'redirect') toast.success(message);
				await applyAction(result);
			};
	}

	const onSaveRecipient = toastOnSuccess('Payout number saved.');
	const onWithdraw = toastOnSuccess('Withdrawal started.');

	const dateFmt = new Intl.DateTimeFormat('en-KE', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});

	const canWithdraw = $derived(data.availableKesCents > 0 && !!data.recipient);

	/**
	 * P9 — a failed or reversed payout stops counting against the derived balance,
	 * so the money is simply back. Saying so plainly matters: a seller seeing
	 * "Failed" next to their own money will otherwise assume it is gone.
	 */
	const RESTORED_NOTE = 'This money is back in your available balance — you can withdraw it again.';
	const isRestored = (status: string) => status === 'failed' || status === 'reversed';
</script>

<svelte:head><title>Payouts · MySoko</title></svelte:head>

<main class="mx-auto max-w-2xl px-4 py-6 sm:py-8">
	<h1 class="font-display text-2xl font-bold text-ink">Payouts</h1>
	<p class="mt-1 text-sm text-muted">Your earnings and where they're sent.</p>

	{#if form?.formError}
		<Alert variant="error" class="mt-6">{form.formError}</Alert>
	{/if}
	{#if form?.withdrawError}
		<Alert variant="error" class="mt-6">{form.withdrawError}</Alert>
	{/if}

	<!-- Balance -->
	<Card class="mt-6">
		<p class="text-sm text-muted">Available for payout</p>
		<div class="mt-1">
			<Price amount={centsToMajor(data.availableKesCents)} size="xl" />
		</div>
		<!-- N2 — this figure is smaller than "Earned from completed orders" on
		     /sell/sales, and that difference must read as intentional. -->
		<p class="mt-1 text-xs text-subtle">
			Ready to withdraw now. Held and already-withdrawn earnings aren't counted —
			<a href="/sell/sales" class="underline hover:text-muted">see all your earnings</a>.
		</p>

		{#if data.pendingKesCents > 0}
			<div class="mt-4 border-t border-border pt-4">
				<p class="text-sm text-muted">
					<Price amount={centsToMajor(data.pendingKesCents)} size="sm" /> on hold — released
					{data.holdDays} days after a buyer confirms they've received their order.
				</p>
				{#if data.releases.length > 0}
					<ul class="mt-2 space-y-1">
						{#each data.releases as release (release.releaseOn)}
							<li class="text-sm text-ink">
								<Price amount={centsToMajor(release.amountKesCents)} size="sm" /> available from
								{dateFmt.format(new Date(release.releaseOn))}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}

		<form
			method="POST"
			action="?/withdrawNow"
			use:enhance={onWithdraw}
			class="mt-5 border-t border-border pt-5"
		>
			{#if canWithdraw}
				<!-- Fee and net rendered server-side, so the cost is visible before
				     submitting rather than after (Section 6 task 2). -->
				<dl class="space-y-1 text-sm">
					<div class="flex justify-between gap-4">
						<dt class="text-muted">Fee (1%)</dt>
						<dd class="text-ink">
							<Price amount={centsToMajor(data.instantFeeKesCents)} size="sm" />
						</dd>
					</div>
					<div class="flex justify-between gap-4">
						<dt class="font-medium text-ink">You receive</dt>
						<dd class="font-medium text-ink">
							<Price amount={centsToMajor(data.instantNetKesCents)} size="sm" />
						</dd>
					</div>
				</dl>
				<Button type="submit" class="mt-4 w-full sm:w-auto">Withdraw now</Button>
				<p class="mt-2 text-xs text-subtle">
					Withdraws your full available balance. Weekly payouts are free — they run every Monday.
				</p>
			{:else if !data.recipient}
				<!-- Empty state: no recipient. Points at the registration form below. -->
				<p class="text-sm text-muted">
					Add your Mpesa number below to withdraw. It takes a moment and only needs doing once.
				</p>
			{:else if data.pendingKesCents > 0}
				<!-- Empty state: zero available, but money is on the way. -->
				<p class="text-sm text-muted">
					Nothing to withdraw yet — your earnings are still on hold. See the dates above.
				</p>
			{:else}
				<!-- Empty state: zero balance, nothing held. -->
				<p class="text-sm text-muted">
					Nothing to withdraw yet. Earnings appear here once buyers confirm their orders.
				</p>
			{/if}
		</form>
	</Card>

	<!-- Recipient -->
	<Card class="mt-4">
		{#if data.recipient}
			<div class="flex flex-wrap items-baseline justify-between gap-2">
				<h2 class="font-display text-base font-semibold text-ink">Your payout number</h2>
				<span class="text-xs text-subtle">
					Added {dateFmt.format(new Date(data.recipient.createdAt))}
				</span>
			</div>
			<p class="mt-3 font-display text-2xl font-bold tracking-wide text-ink tabular-nums">
				{data.recipient.phoneMasked}
			</p>
			<p class="mt-1 text-sm text-muted">
				We store only these digits. The full number stays with Paystack.
			</p>
		{:else}
			<h2 class="font-display text-base font-semibold text-ink">Add your payout number</h2>
			<p class="mt-1 text-sm text-muted">
				Earnings are sent to this Mpesa number. Add it before your first withdrawal.
			</p>
		{/if}

		<form
			method="POST"
			action="?/saveRecipient"
			use:enhance={onSaveRecipient}
			class="mt-5 border-t border-border pt-5"
		>
			<Label for="phone">{data.recipient ? 'Change number' : 'Mpesa number'}</Label>
			<div class="mt-1.5 flex flex-col gap-3 sm:flex-row">
				<div class="flex-1">
					<Input
						id="phone"
						name="phone"
						type="tel"
						inputmode="tel"
						autocomplete="tel"
						placeholder="0712 345678"
						value={form?.phone ?? ''}
						error={form?.formError ? ' ' : undefined}
						required
					/>
				</div>
				<Button type="submit" variant="secondary" class="sm:w-auto">
					{data.recipient ? 'Update number' : 'Save number'}
				</Button>
			</div>
			<p class="mt-2 text-xs text-subtle">
				Safaricom or Airtel, in any format — 0712 345678 or +254 712 345678.
			</p>
		</form>
	</Card>

	<!-- History -->
	<h2 class="mt-8 font-display text-base font-semibold text-ink">Payout history</h2>
	{#if data.history.length === 0}
		<Card class="mt-3 p-6 text-center">
			<p class="text-sm text-muted">No payouts yet. They'll appear here once you withdraw.</p>
		</Card>
	{:else}
		<!-- Cards on small screens, a table from sm up: six columns per row, which a
		     phone-width table can't show without scrolling. Same split as /sell/sales. -->
		<ul class="mt-3 space-y-2 sm:hidden">
			{#each data.history as payout (payout.id)}
				<li>
					<Card class="p-4">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="font-medium text-ink">
									<Price amount={centsToMajor(payout.netKesCents)} size="sm" />
								</p>
								<p class="text-xs text-subtle">
									{payoutOriginLabel(payout.origin)} · {dateFmt.format(new Date(payout.createdAt))}
								</p>
							</div>
							<Badge variant={payoutStatusVariant(payout.status)}>
								{payoutStatusLabel(payout.status)}
							</Badge>
						</div>
						<dl class="mt-3 space-y-1 border-t border-border pt-3 text-sm">
							<div class="flex justify-between gap-4">
								<dt class="text-muted">Amount</dt>
								<dd class="text-ink">
									<Price amount={centsToMajor(payout.amountKesCents)} size="sm" />
								</dd>
							</div>
							<div class="flex justify-between gap-4">
								<dt class="text-muted">Fee</dt>
								<dd class="text-ink">
									<Price amount={centsToMajor(payout.feeKesCents)} size="sm" />
								</dd>
							</div>
						</dl>
						{#if isRestored(payout.status)}
							<p class="mt-3 text-sm text-muted">{RESTORED_NOTE}</p>
						{/if}
					</Card>
				</li>
			{/each}
		</ul>

		<Card class="mt-3 hidden p-0 sm:block">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-border text-left text-xs text-subtle">
						<th scope="col" class="px-4 py-3 font-medium">Date</th>
						<th scope="col" class="px-4 py-3 font-medium">Type</th>
						<th scope="col" class="px-4 py-3 text-right font-medium">Amount</th>
						<th scope="col" class="px-4 py-3 text-right font-medium">Fee</th>
						<th scope="col" class="px-4 py-3 text-right font-medium">You received</th>
						<th scope="col" class="px-4 py-3 font-medium">Status</th>
					</tr>
				</thead>
				<tbody>
					{#each data.history as payout (payout.id)}
						<tr class="border-b border-border last:border-0">
							<td class="px-4 py-3 text-ink">{dateFmt.format(new Date(payout.createdAt))}</td>
							<td class="px-4 py-3 text-muted">{payoutOriginLabel(payout.origin)}</td>
							<td class="px-4 py-3 text-right text-ink">
								<Price amount={centsToMajor(payout.amountKesCents)} size="sm" />
							</td>
							<td class="px-4 py-3 text-right text-muted">
								<Price amount={centsToMajor(payout.feeKesCents)} size="sm" />
							</td>
							<td class="px-4 py-3 text-right font-medium text-ink">
								<Price amount={centsToMajor(payout.netKesCents)} size="sm" />
							</td>
							<td class="px-4 py-3">
								<Badge variant={payoutStatusVariant(payout.status)}>
									{payoutStatusLabel(payout.status)}
								</Badge>
							</td>
						</tr>
						{#if isRestored(payout.status)}
							<tr class="border-b border-border last:border-0">
								<td colspan="6" class="px-4 pb-3 text-sm text-muted">{RESTORED_NOTE}</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</Card>
	{/if}
</main>
