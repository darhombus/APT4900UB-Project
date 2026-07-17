import { error } from '@sveltejs/kit';
import { loadCategoryTree } from '$lib/server/categories';
import { publicUrl } from '$lib/listing-images';
import { findSubcategory } from '$lib/validation/listings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase, user } }) => {
	// RLS returns active/sold to anyone, and drafts/removed only to their owner
	// (or admin). So a missing row is either a bad id or a stranger's draft.
	const { data: listing } = await supabase
		.from('listings')
		.select(
			'id, seller_id, title, description, price, condition, location_area, status, published_at, created_at, category_id'
		)
		.eq('id', params.id)
		.maybeSingle();

	if (!listing) error(404, 'Listing not found');

	const isOwner = !!user && user.id === listing.seller_id;
	const isPublic = listing.status === 'active' || listing.status === 'sold';
	// The public page is owner-only for non-public statuses (drafts/removed).
	// (RLS also lets admins read them, but this page previews for the owner only.)
	if (!isPublic && !isOwner) error(404, 'Listing not found');

	const [imagesRes, sellerRes, tree] = await Promise.all([
		supabase
			.from('listing_images')
			.select('id, storage_path, position')
			.eq('listing_id', listing.id)
			.order('position', { ascending: true }),
		supabase
			.from('profiles')
			.select('full_name, avatar_url, created_at')
			.eq('id', listing.seller_id)
			.single(),
		loadCategoryTree(supabase)
	]);

	const images = (imagesRes.data ?? []).map((img) => ({
		id: img.id,
		url: publicUrl(supabase, img.storage_path)
	}));

	const match = findSubcategory(tree, listing.category_id);
	const breadcrumb = match
		? {
				top: { name: match.top.name, slug: match.top.slug },
				sub: { name: match.sub.name, slug: match.sub.slug }
			}
		: null;

	return { listing, images, seller: sellerRes.data, breadcrumb, isOwner };
};
