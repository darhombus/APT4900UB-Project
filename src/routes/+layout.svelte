<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { onMount } from 'svelte';

	let { data, children } = $props();
	let { session, supabase } = $derived(data);

	/**
	 * Keep server load functions in sync with client-side auth changes. When the
	 * user logs in or out (here or in another tab), Supabase fires onAuthStateChange;
	 * if the session actually changed we invalidate 'supabase:auth', which reruns
	 * every load that declared depends('supabase:auth') — so the UI updates without
	 * a manual refresh.
	 */
	onMount(() => {
		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((_, newSession) => {
			if (newSession?.expires_at !== session?.expires_at) {
				invalidate('supabase:auth');
			}
		});

		return () => subscription.unsubscribe();
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<header class="border-b border-gray-200 bg-white">
	<nav class="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
		<a href="/" class="text-lg font-bold text-gray-900">Marketplace</a>
		<div class="flex items-center gap-4 text-sm">
			{#if session}
				<a href="/account" class="font-medium text-gray-700 hover:text-gray-900">Account</a>
				<form method="POST" action="/logout" use:enhance>
					<button
						type="submit"
						class="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50"
					>
						Log out
					</button>
				</form>
			{:else}
				<a href="/login" class="font-medium text-gray-700 hover:text-gray-900">Log in</a>
				<a
					href="/signup"
					class="rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700"
				>
					Sign up
				</a>
			{/if}
		</div>
	</nav>
</header>

{@render children()}
