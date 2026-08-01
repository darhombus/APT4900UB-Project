/**
 * Kenyan MSISDN normalisation and masking for payout recipients
 * (Payouts PRD — Section 5, P1).
 *
 * The full number is never stored. It goes to Paystack once, at registration,
 * and what lands in `payout_recipients` is the masked form beside the
 * recipient_code Paystack hands back.
 */

/**
 * Kenyan mobile numbers are 254 followed by 7XXXXXXXX (Safaricom/Airtel) or
 * 1XXXXXXXX (the newer 011x range). Sellers type them four different ways, so
 * all four normalise to the same 12-digit international form.
 *
 *   0712345678      → 254712345678
 *   0112345678      → 254112345678
 *   712345678       → 254712345678
 *   +254 712 345678 → 254712345678
 */
const KENYAN_MSISDN = /^254[71]\d{8}$/;

export type PhoneNormalizeResult =
	{ ok: true; msisdn: string; masked: string } | { ok: false; error: string };

/**
 * Normalise seller input to 254XXXXXXXXX, or explain why it isn't a Kenyan
 * mobile number. One error message for every failure mode on purpose: telling a
 * seller exactly which digit is wrong invites them to keep guessing, and the
 * correct format is short enough to simply state.
 */
export function normalizeKenyanPhone(input: string): PhoneNormalizeResult {
	const invalid = {
		ok: false as const,
		error: 'Enter a Kenyan mobile number, for example 0712 345678.'
	};

	if (typeof input !== 'string') return invalid;

	// Strip everything a human might type around the digits: spaces, hyphens,
	// brackets, and a leading +.
	const digits = input.replace(/[\s()+-]/g, '');
	if (!/^\d+$/.test(digits)) return invalid;

	let msisdn: string;
	if (digits.startsWith('254')) {
		msisdn = digits;
	} else if (digits.startsWith('0')) {
		// Local form: swap the trunk 0 for the country code.
		msisdn = `254${digits.slice(1)}`;
	} else if (digits.length === 9) {
		// Bare subscriber number, no trunk prefix.
		msisdn = `254${digits}`;
	} else {
		return invalid;
	}

	if (!KENYAN_MSISDN.test(msisdn)) return invalid;

	return { ok: true, msisdn, masked: maskMsisdn(msisdn) };
}

/**
 * 254712345678 → 2547****678.
 *
 * Keeps the country code and network digit so a seller can tell Safaricom from
 * Airtel, and the last three so they can recognise their own number, while the
 * middle four — the part that identifies the line — never reaches the database.
 */
export function maskMsisdn(msisdn: string): string {
	return `${msisdn.slice(0, 4)}****${msisdn.slice(-3)}`;
}
