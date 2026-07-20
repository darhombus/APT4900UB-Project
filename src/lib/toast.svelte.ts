import type { ActionResult } from '@sveltejs/kit';

/**
 * Toast notifications — transient outcome feedback (success / error / warning /
 * info). This is the single source of truth for the stack; <ToastContainer>
 * (rendered once in the root layout) renders it, and any client code can push a
 * toast via `toast.success('Listing published')`.
 *
 * Field-level validation errors are deliberately NOT toasts — they stay inline
 * next to their inputs (see D6 in the UI-refinements PRD).
 */

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
	id: string;
	variant: ToastVariant;
	message: string;
	/** ms until auto-dismiss; 0 keeps it until the user dismisses it. */
	duration: number;
}

export interface ToastOptions {
	/** Override the default auto-dismiss delay (ms). 0 keeps it until dismissed. */
	duration?: number;
}

// Errors linger; quieter variants clear sooner — a failure the user must read
// stays roughly twice as long as a success confirmation.
const DEFAULT_DURATION: Record<ToastVariant, number> = {
	success: 4500,
	info: 4500,
	warning: 6000,
	error: 8000
};

// Cap the visible stack so a burst of outcomes can't bury the page; the oldest
// falls off the bottom first.
const MAX_VISIBLE = 5;

class ToastStore {
	/** The live stack, oldest first; the container renders newest on top. */
	items = $state<Toast[]>([]);

	// Timers are plumbing, not UI, so they live outside reactive state.
	#timers = new Map<string, ReturnType<typeof setTimeout>>();
	#remaining = new Map<string, number>();
	#startedAt = new Map<string, number>();
	#seq = 0;

	/** Show a toast and return its id. */
	show(message: string, variant: ToastVariant = 'info', opts: ToastOptions = {}): string {
		const id = String(++this.#seq);
		const duration = opts.duration ?? DEFAULT_DURATION[variant];
		this.items.push({ id, variant, message, duration });
		if (duration > 0) this.#arm(id, duration);
		while (this.items.length > MAX_VISIBLE) this.dismiss(this.items[0]!.id);
		return id;
	}

	success(message: string, opts?: ToastOptions): string {
		return this.show(message, 'success', opts);
	}
	error(message: string, opts?: ToastOptions): string {
		return this.show(message, 'error', opts);
	}
	warning(message: string, opts?: ToastOptions): string {
		return this.show(message, 'warning', opts);
	}
	info(message: string, opts?: ToastOptions): string {
		return this.show(message, 'info', opts);
	}

	/** Remove a toast now (manual dismiss, or the auto-dismiss timer firing). */
	dismiss(id: string): void {
		this.#clearTimer(id);
		this.#remaining.delete(id);
		this.#startedAt.delete(id);
		const i = this.items.findIndex((t) => t.id === id);
		if (i !== -1) this.items.splice(i, 1);
	}

	/** Pause auto-dismiss (pointer/focus over the toast), banking the time left. */
	pause(id: string): void {
		if (!this.#timers.has(id)) return;
		this.#clearTimer(id);
		const started = this.#startedAt.get(id) ?? Date.now();
		const left = (this.#remaining.get(id) ?? 0) - (Date.now() - started);
		this.#remaining.set(id, Math.max(0, left));
	}

	/** Resume auto-dismiss with whatever time was left when paused. */
	resume(id: string): void {
		if (this.#timers.has(id)) return; // already running
		const left = this.#remaining.get(id);
		if (left === undefined) return;
		this.#arm(id, left);
	}

	/** Clear everything (used by tests). */
	clear(): void {
		for (const id of [...this.#timers.keys()]) this.#clearTimer(id);
		this.#remaining.clear();
		this.#startedAt.clear();
		this.items = [];
	}

	#arm(id: string, duration: number): void {
		this.#remaining.set(id, duration);
		this.#startedAt.set(id, Date.now());
		this.#timers.set(
			id,
			setTimeout(() => this.dismiss(id), duration)
		);
	}

	#clearTimer(id: string): void {
		const timer = this.#timers.get(id);
		if (timer !== undefined) {
			clearTimeout(timer);
			this.#timers.delete(id);
		}
	}
}

/** The app-wide toast API. Import and call from anywhere on the client. */
export const toast = new ToastStore();

/**
 * Turn a SvelteKit form `ActionResult` into a toast, reading the outcome fields
 * the server actions already return — `formError` / `transitionError` /
 * `resendError` on failure — plus a caller-supplied line for success/redirect.
 * Field-level `errors` are intentionally ignored (they render inline). This keeps
 * the existing action-result convention rather than inventing a second one.
 */
export function notifyFromResult(
	result: ActionResult,
	messages: { success?: string; redirect?: string } = {}
): void {
	if (result.type === 'failure') {
		const data = (result.data ?? {}) as Record<string, unknown>;
		const message = data.formError ?? data.transitionError ?? data.resendError;
		if (typeof message === 'string') toast.error(message);
	} else if (result.type === 'error') {
		toast.error('Something went wrong. Please try again.');
	} else if (result.type === 'success' && messages.success) {
		toast.success(messages.success);
	} else if (result.type === 'redirect' && messages.redirect) {
		toast.success(messages.redirect);
	}
}
