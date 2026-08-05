-- ============================================================================
-- REVIEWS SCHEMA — verified-purchase reviews
-- (Reviews PRD — Section 2; decisions D1–D12, rulings R-1 … R-12)
--
-- THIS IS AN ALTER MIGRATION, NOT A CREATE.
--
-- public.reviews already exists. It was created by the ERD-derived
-- 20260710013856_initial_schema.sql, RLS-enabled by 20260710015112_rls_
-- policies.sql, and its order FK plus `reviews_insert` policy were dropped and
-- restored by 20260727170000_checkout_schema.sql when the order_status enum was
-- rebuilt. The table shipped ahead of the feature it was for: no UI, no server
-- code and no rows have ever touched it.
--
-- Shape inherited from the initial schema:
--
--   id          uuid pk
--   order_id    uuid not null UNIQUE references orders(id)   on delete cascade
--   reviewer_id uuid not null references profiles(id)        on delete cascade
--   seller_id   uuid not null references profiles(id)        on delete cascade
--   listing_id  uuid not null references listings(id)        on delete cascade
--   rating      smallint not null check (rating between 1 and 5)
--   comment     text check (char_length(comment) <= 1000)
--   created_at  timestamptz not null default now()
--   indexes:  reviews_seller_idx (seller_id), reviews_listing_idx (listing_id)
--   policies: reviews_select (using true), reviews_insert (completed-order EXISTS)
--
-- What this migration changes, and why each is not a rewrite:
--   1. renames reviewer_id → buyer_id and comment → body (R-1 vocabulary)
--   2. adds the moderation status enum + column and the seller-response columns
--   3. relies on the UNIQUE and the indexes that are already there
--   4. adds the denormalization-integrity guard the original table never had
--   5. adds trigger-maintained aggregates on listings and profiles
--   6. replaces BOTH shipped policies — `using (true)` predates moderation (D8)
--   7. REVOKEs before GRANTing (see step 7's note — this is the whole ballgame)
--   8. adds the single-shot seller-response function
-- ============================================================================


-- ---- 1. Column vocabulary (R-1) -------------------------------------------
-- Renamed FIRST so that every policy, constraint and function body created
-- below is written against the final names. Postgres rewrites dependent parse
-- trees automatically — the shipped `reviews_insert` policy silently follows
-- the rename — but it is dropped and recreated at step 6 regardless, so the
-- rewrite is belt-and-braces rather than load-bearing.
alter table public.reviews rename column reviewer_id to buyer_id;
alter table public.reviews rename column "comment"   to body;

-- Constraints keep their generated names through a column rename, so without
-- these two the table would carry `reviews_comment_check` over a column called
-- `body` and `reviews_reviewer_id_fkey` over `buyer_id`. Renamed for legibility;
-- both definitions are untouched — the check still enforces D3's 1000-character
-- cap and the FK still cascades from profiles.
alter table public.reviews rename constraint reviews_comment_check    to reviews_body_check;
alter table public.reviews rename constraint reviews_reviewer_id_fkey to reviews_buyer_id_fkey;

-- `rating` deliberately stays smallint (D3). A 1–5 value needs 2 bytes, the
-- existing check already pins the domain, and retyping it would rewrite the
-- table for nothing.


-- ---- 2. Moderation status and seller response (D5, D8) ---------------------
create type public.review_status as enum ('visible', 'hidden');

alter table public.reviews
  add column status              public.review_status not null default 'visible',
  add column seller_response     text,
  add column seller_responded_at timestamptz,
  -- Same 1000-character ceiling the body carries (D5).
  add constraint reviews_seller_response_len
    check (seller_response is null or char_length(seller_response) <= 1000),
  -- The response and its timestamp are written together or not at all, so a
  -- response can never render without a date and a date can never imply a
  -- response that is not there.
  add constraint reviews_seller_response_paired
    check ((seller_response is null) = (seller_responded_at is null));

comment on column public.reviews.status is
  'Moderation visibility (D8). Client roles hold no UPDATE on this table at all; '
  'only service_role may change it, and only this column — see the grants below.';


-- ---- 3. Deliberately NOT changed ------------------------------------------
-- Recorded explicitly so a later reader does not "fix" the omission:
--
--   * reviews_order_id_key — the UNIQUE on order_id already enforces one review
--     per order (D10). It is a plain unique constraint, which is correct: D4
--     frees the slot by DELETING the row, so there is no soft-delete state for
--     a partial index to exclude.
--   * reviews_seller_idx / reviews_listing_idx already exist and cover the two
--     read paths this phase adds (listing page list, seller aggregate).
--   * all four FKs keep ON DELETE CASCADE. Step 5's aggregate trigger is
--     written to survive the cascade rather than the cascade being weakened to
--     suit the trigger.


-- ---- 4. Aggregates (D6) ---------------------------------------------------
-- Denormalized counters, not a view: the listing card grid reads them for every
-- card on every search page, and a per-card subquery there is the N+1 this
-- phase exists to avoid. Averages are computed at read time from the pair —
-- storing an average would lose precision and complicate the increments.
alter table public.listings
  add column review_count integer not null default 0,
  add column rating_sum   integer not null default 0;

alter table public.profiles
  add column review_count integer not null default 0,
  add column rating_sum   integer not null default 0;

comment on column public.profiles.review_count is
  'Seller-level review count across ALL the seller''s listings (D6), including '
  'listings later removed or deleted — a review records seller conduct and '
  'outlives the listing it was written against.';

-- Backfill. The table is empty on every stack today (no code path has ever
-- inserted a review), so this is a no-op — but the counters have exactly one
-- chance to start correct, and a silent zero against pre-existing rows would be
-- unrecoverable without a manual sweep later.
with agg as (
  select listing_id, count(*)::int as c, sum(rating)::int as s
    from public.reviews
   where status = 'visible'
   group by listing_id
)
update public.listings l
   set review_count = agg.c,
       rating_sum   = agg.s
  from agg
 where l.id = agg.listing_id;

with agg as (
  select seller_id, count(*)::int as c, sum(rating)::int as s
    from public.reviews
   where status = 'visible'
   group by seller_id
)
update public.profiles p
   set review_count = agg.c,
       rating_sum   = agg.s
  from agg
 where p.id = agg.seller_id;


-- ---- 5. Denormalization integrity -----------------------------------------
-- listing_id, seller_id and buyer_id are denormalized onto the review for cheap
-- display and cheap aggregate updates (D1). That denormalization is only safe
-- if it cannot disagree with the order it was derived from.
--
-- RLS proves the CALLER owns a completed order. It does NOT prove the row's
-- listing/seller/buyer describe THAT order — without this guard a buyer with
-- one legitimate completed order could post a review carrying any listing_id
-- and seller_id they liked, and the aggregate trigger would faithfully credit
-- or damage a stranger's rating.
--
-- SECURITY DEFINER so the lookup sees the order regardless of the caller's row
-- visibility: a `not found` here must mean the order does not exist, never that
-- RLS filtered it away.
create or replace function public.reviews_verify_denormalization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = new.order_id;

  if not found then
    raise exception 'reviews: order % does not exist', new.order_id
      using errcode = 'P0001';
  end if;

  if new.listing_id is distinct from v_order.listing_id
     or new.seller_id is distinct from v_order.seller_id
     or new.buyer_id  is distinct from v_order.buyer_id then
    raise exception
      'reviews: listing/seller/buyer do not match order %', new.order_id
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists reviews_verify_denormalization on public.reviews;
create trigger reviews_verify_denormalization
  before insert on public.reviews
  for each row execute function public.reviews_verify_denormalization();


-- ---- 6. Aggregate maintenance (D6) ----------------------------------------
-- One function, three triggers. The delta is computed per operation and then
-- applied by a single pair of UPDATEs, so the listing and the seller can never
-- drift apart — the failure mode of writing three near-identical functions.
--
-- Only `visible` rows count (D8). There is no rating-change path to handle:
-- reviews are immutable to their author (D4) and the only UPDATE that exists
-- anywhere is service_role flipping `status`, plus the seller-response function,
-- which touches neither rating nor status.
create or replace function public.reviews_apply_aggregates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing_id  uuid;
  v_seller_id   uuid;
  v_count_delta integer;
  v_rating_delta integer;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'visible' then
      return new;
    end if;
    v_listing_id   := new.listing_id;
    v_seller_id    := new.seller_id;
    v_count_delta  := 1;
    v_rating_delta := new.rating;

  elsif tg_op = 'DELETE' then
    if old.status <> 'visible' then
      return old;
    end if;
    v_listing_id   := old.listing_id;
    v_seller_id    := old.seller_id;
    v_count_delta  := -1;
    v_rating_delta := -old.rating;

  else  -- UPDATE OF status
    v_listing_id := new.listing_id;
    v_seller_id  := new.seller_id;

    if old.status = 'visible' and new.status = 'hidden' then
      v_count_delta  := -1;
      v_rating_delta := -old.rating;
    elsif old.status = 'hidden' and new.status = 'visible' then
      v_count_delta  := 1;
      v_rating_delta := new.rating;
    else
      return new;
    end if;
  end if;

  -- Zero affected rows is a legitimate outcome, not an error: no FOUND check,
  -- no GET DIAGNOSTICS, no exception on a miss.
  --
  -- On the cascade interplay — stated against the schema as it actually is,
  -- because the intuitive version is wrong. reviews.listing_id and
  -- reviews.seller_id are ON DELETE CASCADE, so the apparent risk is this
  -- trigger firing after its parent row has already gone. That is currently
  -- UNREACHABLE: every review requires an order (D1), and orders.listing_id and
  -- orders.seller_id are ON DELETE RESTRICT, so a listing or a profile carrying
  -- reviews cannot be hard-deleted at all. Both attempts raise 23503 — verified
  -- against this migration, not assumed.
  --
  -- The cascade that DOES arrive here is order deletion — the e2e teardown path
  -- (R-5). The review dies with its order while both the listing and the seller
  -- survive, so both decrements below land on a live row.
  --
  -- The tolerance stays regardless. It costs one absent IF, and it keeps this
  -- trigger from becoming a landmine the day a migration loosens one of those
  -- RESTRICTs or introduces a hard-delete path: the listing counter would simply
  -- die with its row, which is the correct outcome, while the profiles decrement
  -- still applies — D6 keeps reviews of removed listings in the seller aggregate.
  update public.listings
     set review_count = review_count + v_count_delta,
         rating_sum   = rating_sum   + v_rating_delta
   where id = v_listing_id;

  update public.profiles
     set review_count = review_count + v_count_delta,
         rating_sum   = rating_sum   + v_rating_delta
   where id = v_seller_id;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists reviews_aggregate_insert on public.reviews;
create trigger reviews_aggregate_insert
  after insert on public.reviews
  for each row execute function public.reviews_apply_aggregates();

drop trigger if exists reviews_aggregate_delete on public.reviews;
create trigger reviews_aggregate_delete
  after delete on public.reviews
  for each row execute function public.reviews_apply_aggregates();

-- WHEN clause rather than an in-function no-op: a moderation UPDATE that does
-- not actually move `status` should not enter the function at all.
drop trigger if exists reviews_aggregate_status on public.reviews;
create trigger reviews_aggregate_status
  after update of status on public.reviews
  for each row
  when (old.status is distinct from new.status)
  execute function public.reviews_apply_aggregates();


-- ---- 7. RLS (D2, D4, D8, D10) ---------------------------------------------
alter table public.reviews enable row level security;
-- FORCE is currently inert on this project: both `postgres` (the table owner,
-- and therefore the owner of every SECURITY DEFINER function above) and
-- `service_role` carry the BYPASSRLS role attribute, which outranks FORCE. It is
-- set anyway so the table's own definition states the intent, and so the
-- guarantee survives an owner that later loses BYPASSRLS.
alter table public.reviews force row level security;

-- Both shipped policies are replaced. `reviews_select using (true)` predates the
-- moderation column and would publish hidden reviews.
drop policy if exists reviews_select on public.reviews;
drop policy if exists reviews_insert on public.reviews;

-- Visible to everyone; an author additionally sees their own hidden review, so
-- the buyer's order surface can tell them it was hidden rather than silently
-- offering the re-review form. For anon, auth.uid() is null and the second
-- disjunct is null → the row is judged on `status` alone.
create policy reviews_select on public.reviews
  for select to anon, authenticated
  using (
    status = 'visible' or buyer_id = auth.uid()
  );

-- Eligibility (D2, D10): the author must be the buyer of the referenced order,
-- and that order must have reached the terminal 'completed' status. This is the
-- same shape the shipped policy had — restated against the renamed column, and
-- still the sole enforcement point for who may review what.
create policy reviews_insert on public.reviews
  for insert to authenticated
  with check (
    buyer_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.buyer_id = auth.uid()
        and o.status = 'completed'
    )
  );

-- D4: an author may delete, which frees the order slot for a fresh review.
create policy reviews_delete on public.reviews
  for delete to authenticated
  using (buyer_id = auth.uid());

-- No UPDATE policy for `authenticated`, by design (D4, D8). Combined with the
-- absent UPDATE grant below, a client UPDATE fails on privilege before RLS is
-- ever consulted.


-- ---- 8. Table privileges (R-9, R-10) --------------------------------------
-- REVOKE FIRST. This is not defensive noise — it is the whole point.
--
-- `reviews` was created in the initial schema and swept up by the blanket
--   grant select, insert, update, delete on all tables in schema public
--     to authenticated;
-- at 20260710015112_rls_policies.sql:59, and the HOSTED project additionally
-- carries `alter default privileges ... grant all on tables`, so it was born
-- with full DML for every role there too. Verified on the local stack
-- immediately before this migration:
--
--   authenticated → SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   service_role  → SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   anon          → SELECT, TRUNCATE, REFERENCES, TRIGGER
--
-- Granting the intended set on top of that removes nothing: `authenticated`
-- would keep UPDATE and D4/D8 would be a convention rather than a privilege.
-- This is the standing lesson recorded at
-- 20260730140000_checkout_grants_hardening.sql:38-41, which names this phase.
revoke all on public.reviews from anon, authenticated, service_role;

-- anon: public reads only. RLS narrows those to status = 'visible'.
grant select on public.reviews to anon;

-- authenticated: read, write one, delete own. NO UPDATE — so a direct client
-- UPDATE is a hard 42501 permission error rather than an RLS zero-row no-op
-- (R-9 semantics), and immutability (D4) is enforced by privilege, not policy.
grant select, insert, delete on public.reviews to authenticated;

-- service_role: everything except a blanket UPDATE. The column-scoped grant is
-- what makes D8 real — service_role BYPASSES RLS, so a table-wide UPDATE here
-- would let any server-side bug rewrite a buyer's rating or body. It may flip
-- moderation visibility and nothing else.
grant select, insert, delete on public.reviews to service_role;
grant update (status)        on public.reviews to service_role;


-- ---- 9. Seller response (D5) ----------------------------------------------
-- The seller needs to write two columns on a row they do not own, on a table
-- where no client role holds UPDATE at all. A SECURITY DEFINER function is the
-- only way through, and it is deliberately the ONLY way through.
--
-- Single-shot is enforced in the WHERE clause, not by a prior SELECT: the
-- `seller_response is null` predicate makes a second response match zero rows,
-- so two concurrent submissions cannot both succeed.
create or replace function public.submit_seller_response(review_id uuid, response text)
returns public.reviews
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.reviews;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if response is null or btrim(response) = '' then
    raise exception 'response_empty' using errcode = 'P0001';
  end if;

  if char_length(btrim(response)) > 1000 then
    raise exception 'response_too_long' using errcode = 'P0001';
  end if;

  -- Every condition that authorizes the write lives in this one statement:
  -- the caller is the review's seller, no response exists yet, and the review
  -- is visible. A hidden review cannot be answered (D8).
  update public.reviews
     set seller_response     = btrim(response),
         seller_responded_at = now()
   where id = review_id
     and seller_id = auth.uid()
     and seller_response is null
     and status = 'visible'
  returning * into v_review;

  if not found then
    raise exception 'response_not_permitted' using errcode = 'P0001';
  end if;

  return v_review;
end;
$$;

-- Mirrors 20260731140000_checkout_function_grant_hardening.sql: revoke from
-- PUBLIC (and the roles that default privileges may have handed it to on
-- hosted) before granting, so local and hosted end up with the same EXECUTE
-- matrix. service_role gets nothing — it has no session and auth.uid() would be
-- null, so the call could only ever raise.
revoke execute on function public.submit_seller_response(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_seller_response(uuid, text)
  to authenticated;
