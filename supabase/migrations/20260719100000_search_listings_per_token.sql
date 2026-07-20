-- ============================================================================
-- PER-TOKEN SEARCH MATCHING (UI Refinements — Section 7, decision D3)
--
-- Fixes the reported defect: the previous `search_listings(q text, …)` matched
-- the WHOLE query as one phrase (`title ilike '%' || q || '%'`), so a multi-word
-- query only matched a listing containing that exact phrase in one column. This
-- replaces it with per-token AND matching: the query is split into tokens by the
-- caller and each token must appear (as a substring) in the title OR description.
-- Still a plain-ILIKE fix, NOT full-text search (D3).
--
-- `q` becomes `text[]` — an ordered list of already-LIKE-escaped tokens (the
-- caller escapes %/_ and caps the count at MAX_SEARCH_TOKENS = 6). The WHERE
-- unrolls six optional token slots rather than iterating `unnest(q)` in a
-- correlated subquery: with `l.title ilike '%' || q[i] || '%'` kept as a direct,
-- top-level predicate on the column, the pg_trgm GIN indexes on title/description
-- (from the listings phase) remain eligible to serve each ILIKE. An absent slot
-- (`q[i] is null`, i.e. fewer than i tokens, or an empty array) is skipped, so an
-- empty query imposes no text filter. Slot count mirrors MAX_SEARCH_TOKENS; any
-- token past the sixth is dropped by the caller and never reaches here.
--
-- Ranking (relevance sort, query present) is extended sensibly: a row whose TITLE
-- contains every token ranks above rows that only satisfy some tokens via the
-- description. This uses a `not exists` over `unnest(q)` — it runs only over the
-- already-filtered result set and only affects ORDER BY, so index eligibility is
-- irrelevant there.
--
-- SECURITY INVOKER (default) + explicit `status = 'active'` keep search
-- active-only, which also excludes soft-`deleted` listings (Section 6).
--
-- The signature changes (text → text[]), so the old overload is dropped first —
-- `create or replace` would otherwise leave two ambiguous overloads.
-- ============================================================================

drop function if exists public.search_listings(
  text, uuid[], numeric, numeric, public.item_condition[], text
);

create or replace function public.search_listings(
  q text[] default '{}',
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
  text[], uuid[], numeric, numeric, public.item_condition[], text
) to anon, authenticated;
