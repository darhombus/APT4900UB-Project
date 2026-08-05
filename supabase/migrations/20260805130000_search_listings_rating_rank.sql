-- ============================================================================
-- SEARCH RANKING — dampened rating as a relevance tie-break
-- (Reviews PRD — Section 3; decisions D6, D7)
--
-- The ONLY change to public.search_listings is one new ORDER BY key. The whole
-- function is restated because `create or replace function` has no partial
-- form — 20260805100000_search_listings_typo_fallback.sql is applied and is not
-- edited. Everything from the tsquery construction down to the three-branch
-- union is byte-identical to that migration; diff the two files and the ORDER BY
-- is the only hunk.
--
-- WHERE THE TERM SITS, AND WHY
--
--   BOOSTS SLOT (still reserved, still a comment, deliberately untouched)
--   → relevance (ts_rank / word_similarity)
--   → dampened rating          ← added here
--   → price pills
--   → published_at
--   → id
--
-- The term is gated on BOTH `sort = 'relevance'` AND `rank_score is not null`.
-- The second half of that guard is the load-bearing one:
--
--   * A category page and an unfiltered browse call this function with q = '{}',
--     which takes the `browse` branch, where rank_score is NULL by construction.
--     Ungated, the rating term would not be a tie-break there at all — it would
--     be the PRIMARY sort, because the relevance CASE above it is also null for
--     those rows. Every category page in the app would silently re-order from
--     newest-first to best-rated-first.
--   * Gated, `browse` rows evaluate both leading keys to null and fall straight
--     through to published_at — byte-identical to the ordering shipped by the
--     previous migration. That equivalence is an acceptance criterion, not an
--     aspiration.
--
-- Price sorts deliberately do NOT tie-break by rating (D7). A buyer who asked
-- for cheapest-first is answering a price question; quietly reordering equal
-- prices by seller rating answers a different one. They fall to published_at.
--
-- The reserved boost slot stays ABOVE relevance, exactly where the search phase
-- left it. Boosts are not implemented here.
-- ============================================================================

-- ---- Load pg_trgm before the SET clause below is parsed ---------------------
-- Same reason as the previous migration: `pg_trgm.word_similarity_threshold` is
-- only a RECOGNIZED GUC once the shared library is loaded into the backend, and
-- setting an unrecognized placeholder requires SUPERUSER, which `postgres` is
-- not. Touching a trigram operator loads it and registers the GUC as USERSET.
-- Needed again here because this migration may run in its own backend session.
do $$ begin perform 'a' <% 'b'; end $$;

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
-- Read by the `%>` operator in the fallback path. 0.30 is permissive, which is
-- the right bias here: the fallback fires only when the user would otherwise
-- see an empty results page, so a loose near-miss beats nothing.
set pg_trgm.word_similarity_threshold = 0.30
as $$
  -- Per token: the collapsed lexeme, and the split parts that survive the
  -- 2-character filter. Ordinality is carried so the constructed tsquery is
  -- deterministic (AND is commutative, but a stable string is easier to debug).
  with expanded as (
    select
      t.ord,
      regexp_replace(lower(t.tok), '[^a-z0-9]', '', 'g') as collapsed,
      (
        select array_agg(p.part order by p.ord)
        from unnest(regexp_split_to_array(lower(t.tok), '[^a-z0-9]+'))
             with ordinality as p(part, ord)
        where length(p.part) >= 2
      ) as parts
    from unnest(coalesce(q, '{}'::text[])) with ordinality as t(tok, ord)
  ),
  terms as (
    select
      e.ord,
      case
        -- One (or no) usable part: the collapsed form is the whole term (R-16).
        when coalesce(cardinality(e.parts), 0) < 2 then e.collapsed || ':*'
        -- Otherwise both readings, OR'd — collapsed, or all parts AND'd.
        else '(' || e.collapsed || ':* | ('
             || (select string_agg(p.part || ':*', ' & ' order by p.ord)
                 from unnest(e.parts) with ordinality as p(part, ord))
             || '))'
      end as term
    from expanded e
    where e.collapsed <> ''   -- pure-punctuation tokens never reach the tsquery
  ),
  query as (
    -- string_agg over zero rows is NULL, so a blank/punctuation-only query
    -- yields tsq = null => no text filter, exactly as shipped.
    select to_tsquery('english', string_agg(t.term, ' & ' order by t.ord)) as tsq
    from terms t
  ),
  -- ---- Blank query: no text filter, default order (One-Time Filter) --------
  browse as (
    select
      l as rec,
      null::real as rank_score
    from public.listings l
    where (select tsq from query) is null
      and l.status = 'active'
      and (category_ids is null or l.category_id = any (category_ids))
      and (min_price is null or l.price >= min_price)
      and (max_price is null or l.price <= max_price)
      and (conditions is null or l.condition = any (conditions))
      and (location is null or l.location_area = location)
  ),
  -- ---- Primary path: full-text search over the weighted vector -------------
  -- The bare `@@` (no disjunction) is what lets this use listings_search_idx.
  -- No `tsq is not null` guard is needed: `search_vector @@ null` is null.
  matched as (
    select
      l as rec,
      ts_rank(l.search_vector, (select tsq from query)) as rank_score
    from public.listings l
    where l.search_vector @@ (select tsq from query)
      and l.status = 'active'
      and (category_ids is null or l.category_id = any (category_ids))
      and (min_price is null or l.price >= min_price)
      and (max_price is null or l.price <= max_price)
      and (conditions is null or l.condition = any (conditions))
      and (location is null or l.location_area = location)
  ),
  -- ---- Typo-rescue path: only when the primary path found nothing ----------
  fallback as (
    select
      l as rec,
      word_similarity(array_to_string(q, ' '), l.title) as rank_score
    from public.listings l
    where (select tsq from query) is not null   -- never fires for a blank query
      and not exists (select 1 from matched)    -- never fires alongside results
      and l.title %> array_to_string(q, ' ')    -- indexable operator form
      and l.status = 'active'
      and (category_ids is null or l.category_id = any (category_ids))
      and (min_price is null or l.price >= min_price)
      and (max_price is null or l.price <= max_price)
      and (conditions is null or l.condition = any (conditions))
      and (location is null or l.location_area = location)
  ),
  -- The three branches are mutually exclusive: `browse` requires a null tsq,
  -- `matched` cannot produce rows for one, and `fallback` requires both a
  -- non-null tsq and an empty `matched`. All three feed the ONE ORDER BY below —
  -- that shared sort is why the union exists, and it is why the rating term is
  -- added in exactly one place rather than per branch.
  combined as (
    select rec, rank_score from browse
    union all
    select rec, rank_score from matched
    union all
    select rec, rank_score from fallback
  )
  select (c.rec).*
  from combined c
  order by
    -- BOOSTS SLOT (boosts phase): featured elevation term inserts here,
    -- within matching results only, above ts_rank — per standing ruling.
    (case when sort = 'relevance' then c.rank_score end) desc nulls last,
    -- Bayesian dampening: M=5 pseudo-reviews at C=3.5 global prior.
    -- Zero-review listings score exactly 3.5 (neutral), preventing a single
    -- 5-star review from outranking fifty 4.8-star reviews.
    --
    -- The `rank_score is not null` half of the guard keeps browse and category
    -- pages on published_at — see this migration's header.
    --
    -- On the constants: M and C are inline and are not configuration. The `5.0`
    -- is written with a decimal point for legibility rather than necessity —
    -- `5 * 3.5` already makes the numerator numeric, so the division is numeric
    -- even against an integer denominator. The decimal keeps that true
    -- independently of how the numerator is later edited.
    (case when sort = 'relevance' and c.rank_score is not null
          then ((c.rec).rating_sum + 5 * 3.5) / ((c.rec).review_count + 5.0)
     end) desc nulls last,
    (case when sort = 'price_asc' then (c.rec).price end) asc nulls last,
    (case when sort = 'price_desc' then (c.rec).price end) desc nulls last,
    (c.rec).published_at desc nulls last,
    (c.rec).id;
$$;

-- `create or replace` preserves existing privileges; restated so a replay from
-- an empty database ends in the same place as an incremental apply.
grant execute on function public.search_listings(
  text[], uuid[], numeric, numeric, public.item_condition[], text, text
) to anon, authenticated;
