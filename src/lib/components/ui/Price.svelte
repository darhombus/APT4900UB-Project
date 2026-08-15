<script lang="ts">
	/**
	 * Renders a KES amount as "KSh 12,500" with thousands separators and tabular
	 * figures so prices line up in dense grids. Accepts an integer, a float, or a
	 * numeric string (Postgres numeric arrives as a string over the wire).
	 *
	 * TWO CONVENTIONS, AND THE SPLIT IS DELIBERATE.
	 *
	 *   default        CATALOGUE prices — a listing, a boost package. "KSh 12,500"
	 *                  is the right way to write a price, and "KSh 12,500.00"
	 *                  would be a regression.
	 *   `showCents`    MONEY-MOVEMENT figures — balances, order totals, fees,
	 *                  payout amounts, held and refunded sums. Anything a user
	 *                  RECONCILES, where the cents are real and dropping a
	 *                  trailing zero misreports the number: 335920 cents rendered
	 *                  "KSh 3,359.2" reads as a truncation of a figure someone is
	 *                  checking against their bank.
	 *
	 * OPT-IN RATHER THAN A CHANGED DEFAULT, so every 2dp call site is a deliberate
	 * edit and no catalogue price becomes 2dp by omission. The cost is that a new
	 * money surface renders 0dp until someone remembers the flag — a plain
	 * boolean prop with no exhaustiveness check, so it is enforced by review, not
	 * by the compiler.
	 */
	interface Props {
		amount: number | string;
		currency?: string;
		size?: 'sm' | 'md' | 'lg' | 'xl';
		/** Force 2dp. Set on every money-movement figure; never on a catalogue price. */
		showCents?: boolean;
		class?: string;
	}

	let {
		amount,
		currency = 'KES',
		size = 'md',
		showCents = false,
		class: klass = ''
	}: Props = $props();

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
			minimumFractionDigits: showCents ? 2 : 0,
			maximumFractionDigits: 2
		}).format(safe);
	});
</script>

<span class={`font-display font-bold text-ink tabular-nums ${sizes[size]} ${klass}`}>
	<span class="font-sans text-[0.75em] font-semibold text-muted">{symbol}</span>
	{formatted}
</span>
