<!--
	UNREACHABLE BY CONSTRUCTION (ADM-40). +page.server.ts redirects every request
	to /account/profile before this can render, but SvelteKit requires a
	+page.svelte for the route to exist as a page at all — and the route has to
	keep existing as the catch-all for bookmarks, typed URLs and anything external
	that still names /account. See the comment there before deleting either file.

	It is a stub rather than the old markup on purpose. What was here was written
	before the design foundation and used raw gray/emerald utilities; its content
	now lives on /account/profile, which is built from the foundation primitives.
	Leaving the old version behind would leave unmigrated markup in the tree for
	someone to later "fix" in place, on a page no one can reach.
-->
<p>Redirecting to your account…</p>
