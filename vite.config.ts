import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Deploy target: Vercel (serverless). Set explicitly so local builds
			// match production. See https://svelte.dev/docs/kit/adapter-vercel
			adapter: adapter(),

			// TYPECHECK THE PLAYWRIGHT SPECS. The generated .svelte-kit/tsconfig.json
			// includes src/, test/ and tests/ but NOT e2e/, so `npm run check` used to
			// report zero errors across 32 spec files it never read. That is how
			// `filter({ hasText: undefined })` — an ordinary TS2339 on a fixture that
			// returns `{ id }` alone — reached main as a locator that silently matched
			// every row (see the local project notes, unverified-break class).
			//
			// Done through this hook rather than by editing .svelte-kit/tsconfig.json,
			// which is GENERATED: `npm run check` runs `svelte-kit sync` first, so a
			// hand-edit there is overwritten before it is ever read. Paths in that file
			// are relative to .svelte-kit/, hence the leading `../`.
			typescript: {
				config: (config) => {
					config.include.push('../e2e/**/*.ts');
					return config;
				}
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
