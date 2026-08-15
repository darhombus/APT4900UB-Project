<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	/**
	 * The admin nav is a flat row, not a hierarchy: these are seven peer surfaces
	 * and none of them contains another. Ordered by how often an admin arrives
	 * with a reason — disputes are the only queue with a person waiting at the
	 * other end, so it leads; the audit log reads the others' history, so it ends.
	 */
	const links = [
		{ href: '/admin', label: 'Overview' },
		{ href: '/admin/disputes', label: 'Disputes' },
		{ href: '/admin/listings', label: 'Listings' },
		{ href: '/admin/reviews', label: 'Reviews' },
		{ href: '/admin/boosts', label: 'Boosts' },
		{ href: '/admin/actions', label: 'Audit log' }
	];

	// `/admin` matches only exactly; the rest match their subtree, so
	// /admin/disputes/<id> keeps Disputes lit.
	const isCurrent = (href: string) =>
		href === '/admin' ? page.url.pathname === '/admin' : page.url.pathname.startsWith(href);
</script>

<div class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
	<header class="border-b border-border pb-4">
		<div class="flex flex-wrap items-baseline justify-between gap-2">
			<h1 class="font-display text-xl font-semibold tracking-tight text-ink">Admin</h1>
			<!-- Says which powers are in play, not who is signed in — the header
			     already carries the account. -->
			<p class="text-xs text-subtle">Moderation and dispute tools</p>
		</div>

		<nav aria-label="Admin sections" class="-mb-px mt-4 flex flex-wrap gap-x-1 gap-y-1">
			{#each links as link (link.href)}
				<a
					href={link.href}
					aria-current={isCurrent(link.href) ? 'page' : undefined}
					class="rounded-control px-3 py-1.5 text-sm font-medium transition-colors
						{isCurrent(link.href)
						? 'bg-brand-tint text-brand-strong'
						: 'text-muted hover:bg-neutral-tint hover:text-ink'}"
				>
					{link.label}
				</a>
			{/each}
		</nav>
	</header>

	<div class="pt-6">
		{@render children()}
	</div>
</div>
