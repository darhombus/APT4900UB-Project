<script lang="ts">
	/**
	 * Renders a KES amount as "KSh 12,500" with thousands separators and tabular
	 * figures so prices line up in dense grids. Accepts an integer, a float, or a
	 * numeric string (Postgres numeric arrives as a string over the wire).
	 */
	interface Props {
		amount: number | string;
		currency?: string;
		size?: 'sm' | 'md' | 'lg' | 'xl';
		class?: string;
	}

	let { amount, currency = 'KES', size = 'md', class: klass = '' }: Props = $props();

	const sizes: Record<NonNullable<Props['size']>, string> = {
		sm: 'text-sm',
		md: 'text-base',
		lg: 'text-xl',
		xl: 'text-3xl'
	};

	// "KSh" is the conventional display symbol for KES in Kenya.
	const symbol = $derived(currency === 'KES' ? 'KSh' : currency);

	const formatted = $derived.by(() => {
		const n = typeof amount === 'string' ? Number(amount) : amount;
		const safe = Number.isFinite(n) ? n : 0;
		return new Intl.NumberFormat('en-KE', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 2
		}).format(safe);
	});
</script>

<span class={`font-display font-bold text-ink tabular-nums ${sizes[size]} ${klass}`}>
	<span class="font-sans text-[0.75em] font-semibold text-muted">{symbol}</span>
	{formatted}
</span>
