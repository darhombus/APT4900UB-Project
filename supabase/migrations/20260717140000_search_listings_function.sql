-- ============================================================================
-- SEARCH FUNCTION (Listings PRD — Section 10)
--
-- Full-text-ish search over active listings using ILIKE on title + description
-- (the Section 5 trigram GIN indexes on both columns make these efficient) with
-- a CASE-based relevance ranking — title matches rank above description-only
-- matches. Deliberately does NOT use the `search_vector` tsvector column (kept in
-- place but unused this phase, per the confirmed rulings).
--
-- The function only does the WHERE + ORDER BY and returns the ordered set; the
-- caller paginates with PostgREST `range` and gets an exact count, so a single
-- definition serves every page. SECURITY INVOKER (the default): RLS on `listings`
-- still applies, and the explicit `status = 'active'` filter keeps search
-- active-only regardless.
--
-- Params (all optional so PostgREST can omit them):
--   q            search text (already LIKE-escaped by the caller; '' = no text filter)
--   category_ids restrict to these category ids (subtree-expanded by the caller);
--                null = no category filter
--   min_price / max_price   inclusive price bounds; null = unbounded
--   conditions   restrict to these item_condition values; null = any
--   sort         'relevance' (default) | 'newest' | 'price_asc' | 'price_desc'
-- ============================================================================

create or replace function public.search_listings(
  q text default '',
  category_ids uuid[] default null,
  min_price numeric default null,
  max_price numeric default null,
  conditions public.item_condition[] default null,
  sort text default 'relevance'
)
returns setof public.listings
language sql
stable
set search_path = public
as $$
  select l.*
  from public.listings l
  where l.status = 'active'
    and (
      q = '' or q is null
      or l.title ilike '%' || q || '%'
      or l.description ilike '%' || q || '%'
    )
    and (category_ids is null or l.category_id = any (category_ids))
    and (min_price is null or l.price >= min_price)
    and (max_price is null or l.price <= max_price)
    and (conditions is null or l.condition = any (conditions))
  order by
    -- Relevance: title matches first, description-only matches after. Only when a
    -- query is present and relevance sort is requested; otherwise a no-op tie.
    (case when sort = 'relevance' and q <> '' and l.title ilike '%' || q || '%' then 0 else 1 end),
    (case when sort = 'price_asc' then l.price end) asc nulls last,
    (case when sort = 'price_desc' then l.price end) desc nulls last,
    l.published_at desc nulls last,
    l.id;
$$;

grant execute on function public.search_listings(
  text, uuid[], numeric, numeric, public.item_condition[], text
) to anon, authenticated;
