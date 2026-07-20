-- ============================================================================
-- LOCATION FILTER (UI Refinements — Section 8 addendum)
--
-- Adds an optional `location` parameter to search_listings. Locations come from
-- the same fixed list the location combobox offers (NAIROBI_AREAS), so an EXACT
-- match on the listing's `location_area` column is correct — no pattern matching.
-- When `location` is null the behaviour is unchanged. Everything else (per-token
-- text matching, category/price/condition filters, relevance ranking, and the
-- active-only filter that also excludes soft-`deleted` listings) is carried over
-- verbatim from 20260719100000_search_listings_per_token.sql.
--
-- The signature gains a 7th argument, so the previous overload is dropped first —
-- otherwise `create or replace` would leave two overloads and PostgREST could not
-- disambiguate. `location` is added LAST with a default so callers that omit it
-- (PostgREST sends named args) keep working.
--
-- A btree index on `location_area` supports the equality predicate. At current
-- row counts the planner may still prefer a sequential scan; the index is for
-- growth (see the DEVLOG EXPLAIN note).
-- ============================================================================

create index if not exists listings_location_area_idx on public.listings (location_area);

drop function if exists public.search_listings(
  text[], uuid[], numeric, numeric, public.item_condition[], text
);

create or replace function public.search_listings(
  q text[] default '{}',
  category_ids uuid[] default null,
  min_price numeric default null,
  max_price numeric default null,
  conditions public.item_condition[] default null,
  sort text default 'relevance',
  location text default null
)
returns setof public.listings
language sql
stable
set search_path = public
as $$
  select l.*
  from public.listings l
  where l.status = 'active'
    -- Every present token must be a substring of the title or the description
    -- (AND across tokens, OR across the two columns). Null slots = no filter.
    and (q[1] is null or l.title ilike '%' || q[1] || '%' or l.description ilike '%' || q[1] || '%')
    and (q[2] is null or l.title ilike '%' || q[2] || '%' or l.description ilike '%' || q[2] || '%')
    and (q[3] is null or l.title ilike '%' || q[3] || '%' or l.description ilike '%' || q[3] || '%')
    and (q[4] is null or l.title ilike '%' || q[4] || '%' or l.description ilike '%' || q[4] || '%')
    and (q[5] is null or l.title ilike '%' || q[5] || '%' or l.description ilike '%' || q[5] || '%')
    and (q[6] is null or l.title ilike '%' || q[6] || '%' or l.description ilike '%' || q[6] || '%')
    and (category_ids is null or l.category_id = any (category_ids))
    and (min_price is null or l.price >= min_price)
    and (max_price is null or l.price <= max_price)
    and (conditions is null or l.condition = any (conditions))
    -- Exact-match location (values come from the fixed combobox list); null = any.
    and (location is null or l.location_area = location)
  order by
    -- Relevance: rows whose TITLE contains every token first, the rest after.
    -- Only when a query is present and relevance sort is requested; else a no-op tie.
    (case
       when sort = 'relevance' and coalesce(cardinality(q), 0) > 0
            and not exists (
              select 1 from unnest(q) as tok where l.title not ilike '%' || tok || '%'
            )
       then 0 else 1
     end),
    (case when sort = 'price_asc' then l.price end) asc nulls last,
    (case when sort = 'price_desc' then l.price end) desc nulls last,
    l.published_at desc nulls last,
    l.id;
$$;

grant execute on function public.search_listings(
  text[], uuid[], numeric, numeric, public.item_condition[], text, text
) to anon, authenticated;
