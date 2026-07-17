import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * The styleguide is a development-only surface. Gate on the environment (not a
 * role): `dev` is true only under `vite dev`, so any production/preview build
 * returns a real 404 for this route.
 */
export const load: PageLoad = () => {
	if (!dev) error(404, 'Not found');
};
