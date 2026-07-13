<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Account · Marketplace</title></svelte:head>

<main class="mx-auto max-w-2xl px-4 py-10">
	<h1 class="text-2xl font-bold text-gray-900">Your account</h1>
	<p class="mt-1 text-sm text-gray-600">You're signed in.</p>

	<dl class="mt-6 divide-y divide-gray-200 rounded-lg border border-gray-200">
		<div class="flex justify-between px-4 py-3">
			<dt class="text-sm font-medium text-gray-500">Name</dt>
			<dd class="text-sm text-gray-900">{data.profile?.full_name ?? '—'}</dd>
		</div>
		<div class="flex justify-between px-4 py-3">
			<dt class="text-sm font-medium text-gray-500">Email</dt>
			<dd class="text-sm text-gray-900">{data.email}</dd>
		</div>
		<div class="flex justify-between px-4 py-3">
			<dt class="text-sm font-medium text-gray-500">Phone</dt>
			<dd class="text-sm text-gray-900">{data.profile?.phone ?? '—'}</dd>
		</div>
		<div class="flex justify-between px-4 py-3">
			<dt class="text-sm font-medium text-gray-500">Role</dt>
			<dd>
				<span
					class="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 capitalize"
				>
					{data.profile?.role ?? 'buyer'}
				</span>
			</dd>
		</div>
	</dl>
</main>
