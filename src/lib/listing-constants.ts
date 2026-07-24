/**
 * Presentation constants for listings: the item-condition enum labels and the
 * Nairobi area list. Split out of `$lib/validation/listings` (which imports zod)
 * so lightweight, every-page components — notably the header SearchBar's filter
 * menu — can import them WITHOUT pulling zod into the root-layout bundle.
 *
 * `$lib/validation/listings` re-exports these, so existing importers are
 * unaffected.
 */

/** The item_condition enum values, with the display labels the UI shows. */
export const CONDITIONS = [
	{ value: 'new', label: 'New' },
	{ value: 'used_like_new', label: 'Used — like new' },
	{ value: 'used_good', label: 'Used — good' },
	{ value: 'used_fair', label: 'Used — fair' }
] as const;

export type ConditionValue = (typeof CONDITIONS)[number]['value'];

/** Display label for a stored condition value ("used_good" → "Used — good"). */
export function conditionLabel(value: string): string {
	return CONDITIONS.find((c) => c.value === value)?.label ?? value;
}

/** Common Nairobi areas offered on the location filter / free-text field. */
export const NAIROBI_AREAS = [
	'Westlands',
	'Kilimani',
	'Kasarani',
	'Embakasi',
	'Karen',
	"Lang'ata",
	'Roysambu',
	'South B',
	'South C',
	'Donholm',
	'Ruaka',
	'CBD'
] as const;
