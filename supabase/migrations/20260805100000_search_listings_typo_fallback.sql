-- ============================================================================
-- SEARCH v2: DUAL-FORM QUERY CONSTRUCTION + TRIGRAM TYPO-RESCUE FALLBACK
-- (Search Relevance PRD v2.2 — Section 2. D5/D6/D7/D9; rulings R-3, R-4, R-11,
--  R-12 as amended by R-14, R-16.)
--
-- Builds on 20260724100000_search_listings_fulltext.sql, which moved search off
-- ILIKE onto the `search_vector` tsvector. Two additions here, plus one
-- structural change to accommodate them. Everything else — the signature, the
-- grants, SECURITY INVOKER, the 'english' config (D3), the active-only filter
-- (D9), and the four-term sort-pill ORDER BY (D6) — is carried over unchanged.
--
-- 1. DUAL-FORM QUERY CONSTRUCTION (D5, R-11)
--
-- The shipped body strips each token to [a-z0-9], which collapses punctuation
-- rather than splitting on it: "iphone-12" became the single lexeme `iphone12`,
-- so it matched a listing titled "iPhone12" but NOT one titled "iPhone 12"
-- (two lexemes). Each token now emits both readings, OR'd:
--
--     "iphone-12"  ->  (iphone12:* | (iphone:* & 12:*))
--
-- Because the collapsed form is always one arm of the disjunction, this is
-- strictly additive to matching — nothing that matched before can stop
-- matching (D1). Rules, per R-11:
--   - Collapsed form empty (pure punctuation, e.g. "!!!")  -> token dropped
--     entirely. Preserves the shipped `lexeme <> ''` guard.
--   - Split parts shorter than 2 characters are discarded, so a token never
--     contributes a single-letter prefix term like `t:*` — those scan an
--     enormous GIN posting list for no selectivity.
--   - Fewer than two parts surviving that filter -> collapsed form only.
--     Accepted consequence (R-16): "e-book" -> parts ["e","book"], "e" is
--     discarded, one survivor remains, so the term is `ebook:*` and will not
--     match a listing titled "E Book". Baseline-equivalent (the shipped body
--     also emitted `ebook:*`), so not a regression. Revisit only if real
--     queries surface it.
--
-- Sanitization stays a WHITELIST. Stripping to [a-z0-9] first means no token
-- can carry tsquery operator syntax (& | ! : * parens quotes backslash), so
-- arbitrary user input still cannot produce a malformed or unintended query —
-- the parentheses and pipes below are ours, never the user's.
--
-- 2. TRIGRAM TYPO-RESCUE FALLBACK (D7)
--
-- A misspelling ("samsng") produces a well-formed tsquery that matches nothing,
-- and FTS has no notion of near-misses. When — and only when — a non-empty
-- query returns zero FTS rows, the search re-runs as a pg_trgm word-similarity
-- match against `title`, rescuing the typo. The two result sets are NEVER
-- merged: the fallback is guarded by `not exists (select 1 from fts)`, so it
-- contributes rows only when the primary path is empty.
--
-- The match string is `array_to_string(q, ' ')` — the RAW, unsanitized token
-- array. That is deliberate: trigram similarity is exactly the tool that
-- tolerates the punctuation and misspellings the whitelist would strip, and it
-- avoids a signature change.
--
-- The predicate uses the OPERATOR form (`title %> needle`), not the function
-- form (`word_similarity(needle, title) > 0.3`). Only the operator is
-- indexable: `%>` is in gin_trgm_ops, so it engages `listings_title_trgm_idx`,
-- while the function form forces a sequential scan. The threshold comes from a
-- function-level SET (below) because the operator reads it from a GUC rather
-- than taking it inline.
--
-- 3. STRUCTURE (R-12, amended by R-14)
--
-- Two paths with different relevance expressions (ts_rank vs word_similarity)
-- feeding one shared ORDER BY forces a union. Each path CTE projects the WHOLE
-- ROW as a composite (`select l as rec, ... as rank_score`) rather than an
-- enumerated column list, and the final projection is `(c.rec).*`. That
-- satisfies `returns setof public.listings` while tracking the table
-- automatically — a later migration adding a listings column cannot silently
-- break this function's return shape.
--
-- `fts` is referenced twice (the union and the not-exists guard), which means
-- PostgreSQL materializes it instead of inlining. That is deliberate: the FTS
-- set is computed exactly once and reused for both the emptiness test and the
-- result, rather than being executed twice.
--
-- 4. THE BLANK QUERY IS NOW ITS OWN BRANCH — AND THAT IS WHAT MAKES THE GIN
--    INDEX USABLE
--
-- A blank or punctuation-only query (`tsq is null`) must still return the
-- default listing order — that is the category-page and empty-search path. The
-- shipped body expressed this as one predicate:
--
--     and (query.tsq is null or l.search_vector @@ query.tsq)
--
-- That disjunction is NOT indexable. EXPLAIN on the shipped shape shows a
-- sequential scan over `listings` with the tsvector match demoted to a join
-- filter — `listings_search_idx` has never been used by search, since the
-- 2026-07-24 migration that introduced it as the primary path. Verified here by
-- isolating the clause: the identical CTE-join query WITHOUT the `is null or`
-- arm plans as a Bitmap Index Scan on `listings_search_idx`.
--
-- So the two cases are now separate, mutually exclusive CTEs:
--   - `browse`  — guarded by `tsq is null`, no text filter at all
--   - `matched` — bare `search_vector @@ <tsq>`, which the planner can serve
--                 from the GIN index
--
-- `matched` needs no explicit `tsq is not null` guard: `search_vector @@ null`
-- evaluates to null, never true, so a blank query yields no rows there anyway.
-- Each branch carries the full filter block, which is repetitive but keeps
-- every path's predicate indexable — a shared filter CTE would reintroduce the
-- join-filter problem this restructure exists to remove.
-- ============================================================================

-- ---- Load pg_trgm before the SET clause below is parsed ---------------------
-- `pg_trgm.word_similarity_threshold` only becomes a RECOGNIZED GUC once the
-- pg_trgm shared library is loaded into the backend, which happens lazily on
-- first use of a pg_trgm function or operator. Until then it is an unvalidated
-- custom placeholder, and setting a placeholder requires SUPERUSER — which the
-- `postgres` role is NOT, on the local stack or on hosted Supabase. Without
-- this line the CREATE FUNCTION below fails with:
--
--   ERROR: permission denied to set parameter "pg_trgm.word_similarity_threshold"
--
-- Touching any trigram operator first loads the library and registers the GUC
-- as USERSET, after which the SET clause is accepted. This only matters at
-- CREATE time: once stored in pg_proc.proconfig the setting is applied on
-- function entry without a permission re-check, so backends that have never
-- loaded pg_trgm still run the function with the intended 0.30 threshold.
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
  -- non-null tsq and an empty `matched`.
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
    (case when sort = 'price_asc' then (c.rec).price end) asc nulls last,
    (case when sort = 'price_desc' then (c.rec).price end) desc nulls last,
    (c.rec).published_at desc nulls last,
    (c.rec).id;
$$;

grant execute on function public.search_listings(
  text[], uuid[], numeric, numeric, public.item_condition[], text, text
) to anon, authenticated;
