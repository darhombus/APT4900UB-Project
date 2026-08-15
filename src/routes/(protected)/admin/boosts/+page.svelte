<script lang="ts">
	import { enhance } from '$app/forms';
	import { Alert, Button, Card, Price } from '$lib/components/ui';
	import { toast } from '$lib/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let confirming = $state<string | null>(null);
	let submitting = $state<string | null>(null);

	const dateFmt = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
</script>

<svelte:head><title>Boosts · Admin · MySoko</title></svelte:head>

{#if form?.actionError}
	<Alert variant="error">{form.actionError}</Alert>
{/if}

{#if data.boosts.length === 0}
	<Card>
		<p class="text-sm font-medium text-ink">No boosts running</p>
		<p class="mt-1 text-sm text-muted">Nothing is currently elevated in search.</p>
	</Card>
{:else}
	<ul class="space-y-3">
		{#each data.boosts as boost (boost.id)}
			<li>
				<Card>
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0">
							<a
								href="/listings/{boost.listingId}"
								class="block truncate text-sm font-medium text-ink hover:text-brand"
							>
								{boost.listingTitle}
							</a>
							<p class="mt-1 text-xs text-subtle">
								<a class="hover:text-brand" href="/admin/users/{boost.sellerId}"
									>{boost.sellerName}</a
								>
								· {boost.durationDays}-day boost ·
								<Price amount={boost.priceKes} size="sm" />
							</p>
							<p class="mt-1 text-xs text-subtle">
								Ends {dateFmt.format(new Date(boost.expiresAt))}
							</p>
						</div>

						<div class="shrink-0">
							{#if confirming === boost.id}
								<form
									method="POST"
									action="?/terminate"
									use:enhance={() => {
										submitting = boost.id;
										return async ({ update, result }) => {
											submitting = null;
											if (result.type === 'success') {
												confirming = null;
												toast.success('Boost ended');
											}
											await update();
										};
									}}
								>
									<input type="hidden" name="boostId" value={boost.id} />
									<div class="flex gap-2">
										<Button
											type="submit"
											variant="destructive"
											size="sm"
											loading={submitting === boost.id}
										>
											End now
										</Button>
										<Button variant="ghost" size="sm" onclick={() => (confirming = null)}>
											Cancel
										</Button>
									</div>
								</form>
							{:else}
								<Button variant="secondary" size="sm" onclick={() => (confirming = boost.id)}>
									End boost
								</Button>
							{/if}
						</div>
					</div>

					{#if confirming === boost.id}
						<p class="mt-3 border-t border-border pt-3 text-sm text-muted">
							The listing stops being elevated immediately. The seller is not refunded — this is the
							same end state as the boost running out.
						</p>
					{/if}
				</Card>
			</li>
		{/each}
	</ul>
{/if}
