<script lang="ts">
	/**
	 * PLACEHOLDER — Section 3 replaces this file entirely.
	 *
	 * SvelteKit refuses to serve a route whose only file is `+page.server.ts`
	 * ("Missing +page.svelte component for route /sellers/[id]", a 500 on every
	 * request), so the Section 2 load function cannot ship on its own without
	 * leaving the route broken on `dev`. This is the smallest thing that keeps it
	 * functional and lets the load be verified end to end.
	 *
	 * Deliberately unstyled and structurally nothing: the real page is four blocks
	 * built from the design foundation, and inventing any of it here would be
	 * Section 3's work done in the wrong commit and without the frontend-design
	 * skill. Everything below is scaffolding to be deleted.
	 */
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<h1>{data.seller.full_name}</h1>
<p>{data.reviewTotal} reviews · {data.listingTotal} active listings</p>
<p>Showing {data.reviews.length} reviews and {data.listings.length} listings.</p>
