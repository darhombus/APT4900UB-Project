<script lang="ts">
	import {
		Button,
		Input,
		Textarea,
		Select,
		Label,
		Card,
		Badge,
		Price,
		Alert
	} from '$lib/components/ui';

	let boundValue = $state('');

	const tokens = [
		{ name: 'brand', cls: 'bg-brand' },
		{ name: 'brand-hover', cls: 'bg-brand-hover' },
		{ name: 'brand-tint', cls: 'bg-brand-tint' },
		{ name: 'accent', cls: 'bg-accent' },
		{ name: 'accent-tint', cls: 'bg-accent-tint' },
		{ name: 'ink', cls: 'bg-ink' },
		{ name: 'muted', cls: 'bg-muted' },
		{ name: 'subtle', cls: 'bg-subtle' },
		{ name: 'page', cls: 'bg-page' },
		{ name: 'border', cls: 'bg-border' },
		{ name: 'success', cls: 'bg-success' },
		{ name: 'warning', cls: 'bg-warning' },
		{ name: 'error', cls: 'bg-error' }
	];

	const statuses = ['draft', 'active', 'paused', 'sold', 'removed'] as const;
</script>

<svelte:head><title>Styleguide · MySoko</title></svelte:head>

<main class="mx-auto max-w-5xl space-y-14 px-4 py-10">
	<header>
		<Badge variant="accent">Dev only</Badge>
		<h1 class="mt-3 font-display text-3xl font-bold text-ink">MySoko design foundation</h1>
		<p class="mt-1 text-muted">
			Every base component and token, rendered in every variant. Direction “Soko”.
		</p>
	</header>

	<!-- ── Color tokens ────────────────────────────────────────────────────── -->
	<section class="space-y-4">
		<h2 class="font-display text-xl font-semibold text-ink">Color tokens</h2>
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
			{#each tokens as t (t.name)}
				<div>
					<div class={`h-14 rounded-control border border-border ${t.cls}`}></div>
					<p class="mt-1 text-xs text-muted">{t.name}</p>
				</div>
			{/each}
		</div>
	</section>

	<!-- ── Typography ──────────────────────────────────────────────────────── -->
	<section class="space-y-4">
		<h2 class="font-display text-xl font-semibold text-ink">Typography</h2>
		<div class="space-y-2">
			<p class="font-display text-4xl font-bold text-ink">Space Grotesk — display</p>
			<p class="font-sans text-base text-ink">
				Inter — body copy. The quick brown fox jumps over the lazy dog. 0123456789.
			</p>
			<p class="text-sm text-muted">Muted secondary text (Inter 400).</p>
			<p class="text-sm text-subtle">Subtle caption text (Inter 400).</p>
		</div>
	</section>

	<!-- ── Prices ──────────────────────────────────────────────────────────── -->
	<section class="space-y-4">
		<h2 class="font-display text-xl font-semibold text-ink">Price</h2>
		<div class="flex flex-wrap items-baseline gap-6">
			<Price amount={500} size="sm" />
			<Price amount={12500} size="md" />
			<Price amount={149999} size="lg" />
			<Price amount={2450000} size="xl" />
			<Price amount="999.5" size="md" />
			<!-- The two conventions, side by side. Catalogue prices drop trailing
			     zeros; money-movement figures never do (a balance reading "3,359.2"
			     reads as a truncation of a number someone is reconciling). -->
			<Price amount={3359.2} size="md" />
			<Price showCents amount={3359.2} size="md" />
		</div>
		<p class="text-sm text-subtle">Integers, numeric strings, and large values — all tabular.</p>
	</section>

	<!-- ── Buttons ─────────────────────────────────────────────────────────── -->
	<section class="space-y-4">
		<h2 class="font-display text-xl font-semibold text-ink">Buttons</h2>
		<div class="flex flex-wrap items-center gap-3">
			<Button variant="primary">Primary</Button>
			<Button variant="secondary">Secondary</Button>
			<Button variant="ghost">Ghost</Button>
			<Button variant="destructive">Destructive</Button>
		</div>
		<div class="flex flex-wrap items-center gap-3">
			<Button size="sm">Small</Button>
			<Button size="md">Medium</Button>
			<Button size="lg">Large</Button>
		</div>
		<div class="flex flex-wrap items-center gap-3">
			<Button loading>Loading</Button>
			<Button disabled>Disabled</Button>
			<Button variant="secondary" href="/dev/styleguide">Link button</Button>
		</div>
	</section>

	<!-- ── Badges ──────────────────────────────────────────────────────────── -->
	<section class="space-y-4">
		<h2 class="font-display text-xl font-semibold text-ink">Badges</h2>
		<div class="flex flex-wrap items-center gap-2">
			<Badge variant="neutral">Neutral</Badge>
			<Badge variant="brand">Brand</Badge>
			<Badge variant="accent">New</Badge>
			<Badge variant="success">Success</Badge>
			<Badge variant="warning">Warning</Badge>
			<Badge variant="error">Error</Badge>
		</div>
		<p class="text-sm text-subtle">Listing statuses:</p>
		<div class="flex flex-wrap items-center gap-2">
			{#each statuses as s (s)}
				<Badge variant={s}><span class="capitalize">{s}</span></Badge>
			{/each}
		</div>
	</section>

	<!-- ── Alerts ──────────────────────────────────────────────────────────── -->
	<section class="space-y-3">
		<h2 class="font-display text-xl font-semibold text-ink">Alerts</h2>
		<Alert variant="success">Profile saved.</Alert>
		<Alert variant="error">That email or password didn't match.</Alert>
		<Alert variant="warning">Your session has expired — please reset by email.</Alert>
		<Alert variant="info">We sent a verification link to your inbox.</Alert>
	</section>

	<!-- ── Form controls ───────────────────────────────────────────────────── -->
	<section class="space-y-4">
		<h2 class="font-display text-xl font-semibold text-ink">Form controls</h2>
		<div class="grid gap-6 sm:grid-cols-2">
			<div>
				<Label for="sg-name">Full name</Label>
				<Input id="sg-name" bind:value={boundValue} placeholder="e.g. Amina Wanjiru" />
				<p class="mt-1 text-xs text-subtle">Bound value: {boundValue || '—'}</p>
			</div>
			<div>
				<Label for="sg-email">Email</Label>
				<Input
					id="sg-email"
					type="email"
					value="not-an-email"
					error="Enter a valid email address"
				/>
			</div>
			<div>
				<Label for="sg-area" optional>Location</Label>
				<Select id="sg-area" placeholder="Choose an area…">
					<option>Westlands</option>
					<option>Kasarani</option>
					<option>Karen</option>
				</Select>
			</div>
			<div>
				<Label for="sg-cond">Condition</Label>
				<Select id="sg-cond" error="Choose a condition" placeholder="Choose…">
					<option>Brand new</option>
					<option>Used — good</option>
				</Select>
			</div>
			<div class="sm:col-span-2">
				<Label for="sg-desc">Description</Label>
				<Textarea id="sg-desc" placeholder="Describe what you're selling…" />
			</div>
		</div>
	</section>

	<!-- ── Cards ───────────────────────────────────────────────────────────── -->
	<section class="space-y-4">
		<h2 class="font-display text-xl font-semibold text-ink">Cards</h2>
		<div class="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
			<Card>
				<h3 class="font-medium text-ink">Default card</h3>
				<p class="mt-1 text-sm text-muted">A padded surface with a hairline border.</p>
			</Card>

			<Card href="/dev/styleguide">
				<h3 class="font-medium text-ink">Link card</h3>
				<p class="mt-1 text-sm text-muted">Hover for the interactive elevation.</p>
			</Card>

			<!-- Preview of the eventual listing card -->
			<Card href="/dev/styleguide" padded={false} class="overflow-hidden">
				<div class="relative aspect-[4/3] bg-neutral-tint">
					<span class="absolute top-2 left-2">
						<Badge variant="accent">New</Badge>
					</span>
				</div>
				<div class="space-y-1 p-3">
					<p class="line-clamp-2 text-sm font-medium text-ink">Samsung Galaxy A14 128GB</p>
					<Price amount={12500} size="md" />
					<p class="text-xs text-subtle">Good · Kasarani</p>
				</div>
			</Card>
		</div>
	</section>
</main>
