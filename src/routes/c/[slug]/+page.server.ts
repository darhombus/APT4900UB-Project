import { error } from '@sveltejs/kit';
import { loadCategoryTree } from '$lib/server/categories';
import { toCardData } from '$lib/listings-view';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 24;
const SORTS = ['newest', 'price_asc', 'price_desc'] as const;
type Sort = (typeof SORTS)[number];

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const tree = await loadCategoryTree(supabase);

	// Resolve the slug to a top-level category or a subcategory.
	let top = tree.find((t) => t.slug === params.slug) ?? null;
	let sub: { id: string; name: string; slug: string } | null = null;
	if (!top) {
		for (const t of tree) {
			const child = t.children.find((c) => c.slug === params.slug);
			if (child) {
				top = t;
				sub = child;
				break;
			}
		}
	}
	if (!top) error(404, 'Category not found');

	const isTop = sub === null;
	// Top-level: listings across the whole subtree; subcategory: just its own.
	const categoryIds = isTop ? top.children.map((c) => c.id) : [sub!.id];

	const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
	const sortParam = url.searchParams.get('sort') ?? 'newest';
	const sort: Sort = (SORTS as readonly string[]).includes(sortParam)
		? (sortParam as Sort)
		: 'newest';
	const from = (page - 1) * PAGE_SIZE;

	let query = supabase
		.from('listings')
		.select(
			'id, title, price, location_area, condition, published_at, created_at, listing_images(storage_path, position)',
			{ count: 'exact' }
		)
		.eq('status', 'active')
		.in('category_id', categoryIds);

	if (sort === 'price_asc') query = query.order('price', { ascending: true });
	else if (sort === 'price_desc') query = query.order('price', { ascending: false });
	else query = query.order('published_at', { ascending: false });
	query = query.order('id', { ascending: true }); // stable tiebreaker for pagination

	const { data, count } = await query.range(from, from + PAGE_SIZE - 1);

	const total = count ?? 0;
	return {
		heading: isTop ? top.name : sub!.name,
		slug: params.slug,
		parent: isTop ? null : { name: top.name, slug: top.slug },
		subcategories: isTop ? top.children.map((c) => ({ name: c.name, slug: c.slug })) : [],
		listings: (data ?? []).map((l) => toCardData(supabase, l)),
		page,
		pageSize: PAGE_SIZE,
		total,
		totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
		sort
	};
};
