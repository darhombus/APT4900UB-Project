import {
	notificationCopy,
	notificationHref,
	type NotificationPayload,
	type NotificationType
} from '$lib/notifications';

/**
 * Email templates (Notifications PRD — Section 4; NTF-8).
 *
 * One base shell, seven content blocks, all rendered from the SAME
 * `notificationCopy` the in-app inbox uses — so an email and its inbox row can
 * never say different things about the same event.
 *
 * WHY THE STYLING LOOKS NOTHING LIKE THE REST OF THE APP'S CODE. Tailwind
 * classes do not exist in an email: there is no stylesheet to link, Gmail strips
 * <style> blocks it dislikes, and Outlook's rendering engine is Word. Every rule
 * here is an inline attribute on the element it styles, and the layout is a
 * table because that is the only construct every client agrees on.
 *
 * The values below are hand-ported from the @theme tokens in routes/layout.css
 * (NTF-8) and must be updated together with them — there is no import that can
 * enforce that, which is exactly why they are listed in one block with the token
 * name beside each.
 */

const PALETTE = {
	brand: '#067a57', // --color-brand
	brandStrong: '#05593f', // --color-brand-strong
	ink: '#0f1b2d', // --color-ink
	muted: '#45525f', // --color-muted
	subtle: '#6b7680', // --color-subtle
	page: '#f7f8f7', // --color-page
	surface: '#ffffff', // --color-surface
	border: '#e2e6e4' // --color-border
} as const;

// --font-sans, minus the Fontsource family: a webfont cannot be relied on in
// mail, so the stack starts at the system fonts the theme already falls back to.
const FONT_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

export interface RenderedEmail {
	subject: string;
	html: string;
	/** Plain-text alternative. Not optional: a body-less part trips spam filters. */
	text: string;
}

/** Escape everything interpolated into the HTML — listing titles are user input. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Absolute URL for a notification's destination.
 *
 * Relative links are meaningless in an email client, so the app origin is
 * prepended here. It arrives as an argument rather than being read from `env`
 * so this module stays pure and testable.
 */
function absoluteUrl(appUrl: string, path: string): string {
	return `${appUrl.replace(/\/+$/, '')}${path}`;
}

export interface RenderInput {
	type: NotificationType;
	payload: NotificationPayload;
	appUrl: string;
	/** True for the four toggle-governed events — drives the footer line only. */
	optional: boolean;
}

/**
 * The shared shell (NTF-8): centred card on the app's page colour, a wordmark, a
 * heading, a paragraph, one button, and a footer.
 *
 * 600px is the conventional maximum an email client will render without
 * horizontal scrolling; the table collapses to full width below that.
 */
function shell(args: {
	title: string;
	body: string;
	action: string;
	url: string;
	footer: string;
}): string {
	const { title, body, action, url, footer } = args;

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PALETTE.page};font-family:${FONT_STACK};color:${PALETTE.ink};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PALETTE.page};padding:24px 12px;">
<tr>
<td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

<tr>
<td style="padding:0 0 16px 4px;font-size:18px;font-weight:700;letter-spacing:-0.01em;color:${PALETTE.brandStrong};">
MySoko
</td>
</tr>

<tr>
<td style="background-color:${PALETTE.surface};border:1px solid ${PALETTE.border};border-radius:12px;padding:28px 28px 24px 28px;">
<h1 style="margin:0 0 12px 0;font-size:20px;line-height:1.3;font-weight:700;color:${PALETTE.ink};">
${escapeHtml(title)}
</h1>
<p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:${PALETTE.muted};">
${escapeHtml(body)}
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td style="background-color:${PALETTE.brand};border-radius:8px;">
<a href="${escapeHtml(url)}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
${escapeHtml(action)}
</a>
</td>
</tr>
</table>
</td>
</tr>

<tr>
<td style="padding:16px 4px 0 4px;font-size:12px;line-height:1.6;color:${PALETTE.subtle};">
${escapeHtml(footer)}
</td>
</tr>

</table>
</td>
</tr>
</table>
</body>
</html>`;
}

/**
 * The footer line, and the one place the two email classes differ visibly.
 *
 * A transactional receipt says it cannot be turned off, because it cannot
 * (NTF-3) — telling someone to visit settings that will not help them is worse
 * than saying nothing. An activity email points at the switch that governs it.
 */
function footerFor(optional: boolean, appUrl: string): string {
	return optional
		? `You are receiving this because activity emails are on for your account. Turn them off at ${absoluteUrl(appUrl, '/account/profile')}.`
		: 'This is a transaction receipt from MySoko, so it is sent even when activity emails are off.';
}

/**
 * Subject lines.
 *
 * Deliberately NOT `notificationCopy().title` verbatim for every type: a subject
 * competes in a crowded inbox and benefits from the specifics an in-app heading
 * does not need — the item, the amount — while the in-app title sits directly
 * above its own body and would only repeat itself.
 */
function subjectFor(type: NotificationType, payload: NotificationPayload, title: string): string {
	const item = payload.listingTitle?.trim();

	switch (type) {
		case 'order.paid':
			return payload.role === 'seller'
				? item
					? `New order: ${item}`
					: 'You have a new order'
				: item
					? `Payment confirmed for ${item}`
					: 'Payment confirmed';
		case 'order.completed':
			return payload.role === 'seller' ? 'An order was completed' : 'Your order is complete';
		case 'payout.sent':
			return 'Your payout is on its way';
		case 'review.received':
			return `You received a ${payload.rating ?? 0}-star review`;
		case 'review.response':
			return 'The seller replied to your review';
		case 'boost.activated':
			return item ? `Boost active: ${item}` : 'Your boost is live';
		case 'boost.expiring_24h':
			return item ? `Boost ending tomorrow: ${item}` : 'Your boost ends tomorrow';
		default:
			// Unreachable — the union is closed. Present so a future eighth event
			// cannot ship with an empty subject if someone forgets this switch.
			return title;
	}
}

/**
 * Render one notification as an email.
 *
 * Pure: the same inputs always produce the same bytes, which is what lets the
 * Section 7 tests assert on rendering per event type without a network.
 */
export function renderNotificationEmail(input: RenderInput): RenderedEmail {
	const { type, payload, appUrl, optional } = input;
	const copy = notificationCopy(type, payload);
	const url = absoluteUrl(appUrl, notificationHref(type, payload));
	const footer = footerFor(optional, appUrl);

	return {
		subject: subjectFor(type, payload, copy.title),
		html: shell({ title: copy.title, body: copy.body, action: copy.action, url, footer }),
		// The plain-text part carries the same words and the same link. A recipient
		// reading text-only must not get a worse message, just a plainer one.
		text: [copy.title, '', copy.body, '', `${copy.action}: ${url}`, '', footer].join('\n')
	};
}
