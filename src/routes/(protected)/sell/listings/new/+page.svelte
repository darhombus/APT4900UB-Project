<script lang="ts">
	import ListingForm from '$lib/components/ListingForm.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>New listing · MySoko</title></svelte:head>

<ListingForm
	supabase={data.supabase}
	sellerId={data.sellerId}
	categoryTree={data.categoryTree}
	{form}
/>
