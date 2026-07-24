-- ============================================================================
-- FULL-TEXT SEARCH (replaces per-token ILIKE substring matching)
--
-- Reported defect: the per-token ILIKE search matched an arbitrary substring
-- anywhere in title/description, so a query like "phon" matched any listing
-- containing that letter run mid-word (e.g. "iPhone", "microphone",
-- "headphones") — search returned a mostly-irrelevant grab bag for anything
-- short of a near-complete word. This supersedes the earlier "plain ILIKE,
-- not full-text search" call (D3, Section 10): `listings.search_vector`
-- (generated, GIN-indexed, title weight A / description weight B) has sat
-- unused since the listings phase — this switches search_listings to use it.
--
-- Each token is lowercased and stripped to [a-z0-9] before being turned into
-- a PREFIX lexeme (`tok:*`); all present tokens are ANDed into one tsquery.
-- Stripping first means a token can never contain tsquery operator syntax
-- (`&`, `|`, `:`, parens, quotes), so arbitrary user input can't produce a
-- malformed or unintended query. Prefix matching keeps "still typing" queries
-- working ("phon" → matches "Phone"/"Phones"), but — unlike ILIKE — only at a
-- real word boundary, which is exactly the fix for the reported defect.
--
-- Same signature as before (q text[], category_ids, min/max_price, conditions,
-- sort, location) — a plain CREATE OR REPLACE, no dropped overload needed.
-- Ranking uses ts_rank against the weighted vector (replacing the old
-- hand-rolled title-vs-description CASE), so title matches still outrank
-- description-only matches.
-- ============================================================================

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
  with tokens as (
    select regexp_replace(lower(tok), '[^a-z0-9]', '', 'g') as lexeme
    from unnest(coalesce(q, '{}'::text[])) as tok
  ),
  query as (
    select to_tsquery('english', string_agg(lexeme || ':*', ' & ')) as tsq
    from tokens
    where lexeme <> ''
  )
  select l.*
  from public.listings l, query
  where l.status = 'active'
    -- No text filter when the query has no surviving tokens (blank/punctuation-only q).
    and (query.tsq is null or l.search_vector @@ query.tsq)
    and (category_ids is null or l.category_id = any (category_ids))
    and (min_price is null or l.price >= min_price)
    and (max_price is null or l.price <= max_price)
    and (conditions is null or l.condition = any (conditions))
    and (location is null or l.location_area = location)
  order by
    (case
       when sort = 'relevance' and query.tsq is not null then ts_rank(l.search_vector, query.tsq)
     end) desc nulls last,
    (case when sort = 'price_asc' then l.price end) asc nulls last,
    (case when sort = 'price_desc' then l.price end) desc nulls last,
    l.published_at desc nulls last,
    l.id;
$$;

grant execute on function public.search_listings(
  text[], uuid[], numeric, numeric, public.item_condition[], text, text
) to anon, authenticated;
