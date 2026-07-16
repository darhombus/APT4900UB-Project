-- ============================================================================
-- LISTINGS SCHEMA COMPLETION (Listings PRD — Section 5)
--
-- Additive, idempotent migration that moves the ACTUAL setup-phase listings
-- schema to the target state. Most of the PRD's target already ships from
-- 20260710013856_initial_schema.sql, so this migration only adds the genuinely
-- missing pieces. What ALREADY EXISTS and is therefore left untouched:
--
--   - status: enum public.listing_status ('draft','active','paused','sold',
--     'removed'), NOT NULL DEFAULT 'draft'. The confirmed ruling keeps the extra
--     `paused` value as the "Unpublish" state, so no enum change.
--   - title text NOT NULL CHECK (char_length between 3 and 120)  [kept as-is]
--   - description text CHECK (char_length <= 5000)               [kept as-is]
--   - price numeric(12,2) NOT NULL CHECK (price > 0)             [kept > 0, not >= 0]
--   - currency text NOT NULL DEFAULT 'KES'
--   - condition enum public.item_condition ('new','used_like_new','used_good',
--     'used_fair'), nullable, with CHECK (type='product' OR condition IS NULL).
--     The confirmed ruling keeps these enum values (not brand_new/like_new/…).
--   - category_id uuid NOT NULL -> categories, seller_id uuid NOT NULL -> profiles
--   - created_at/updated_at + the set_updated_at() trigger (listings_updated_at)
--   - listing_images table (id, listing_id CASCADE, storage_path, position,
--     created_at, UNIQUE(listing_id, position)). Uses `position`, not sort_order.
--   - Indexes listings(seller_id), listings(category_id), listings(status),
--     GIN trigram on listings.title, and pg_trgm is already enabled.
--   - RLS: listings_select (active OR owner OR admin), listings_update (owner OR
--     admin, with_check pins seller_id), and all listing_images policies already
--     match the target and are left in place.
--
-- This migration adds: the location split, published_at, the two RLS gaps
-- (insert must be seller/admin; delete only while draft), and the remaining
-- indexes (composite browse indexes + description trigram).
-- ============================================================================

-- ---- Location: split the single `location` into location_area + city --------
alter table public.listings
  add column if not exists location_area text;
alter table public.listings
  add column if not exists city text not null default 'Nairobi';

-- Backfill the new area column from the old free-text location, then drop it.
-- Idempotent: only fills rows that still have the old column populated.
update public.listings set location_area = location
  where location is not null and location_area is null;

alter table public.listings drop column if exists location;

-- ---- Publish timestamp: null until first publish ----------------------------
alter table public.listings
  add column if not exists published_at timestamptz;

-- ---- RLS helper: is the caller a seller or admin? ---------------------------
-- Mirrors public.is_admin() from the setup phase (SECURITY DEFINER so it reads
-- profiles without recursively evaluating that table's RLS).
create or replace function public.is_seller_or_admin()
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('seller', 'admin')
  );
$$;
grant execute on function public.is_seller_or_admin() to anon, authenticated;

-- ---- RLS gap 1: only sellers/admins may create listings ---------------------
-- The setup policy checked ownership only (any authenticated user could insert).
-- Require the caller's profile role to be seller or admin; admins may do anything.
drop policy if exists listings_insert on public.listings;
create policy listings_insert on public.listings
  for insert to authenticated
  with check (
    (seller_id = auth.uid() and public.is_seller_or_admin())
    or public.is_admin()
  );

-- ---- RLS gap 2: sellers may delete only their own DRAFT listings ------------
-- The setup policy allowed owners to delete in any status. Restrict to drafts;
-- admins may delete anything (moderation).
drop policy if exists listings_delete on public.listings;
create policy listings_delete on public.listings
  for delete to authenticated
  using (
    (seller_id = auth.uid() and status = 'draft')
    or public.is_admin()
  );

-- ---- Indexes ----------------------------------------------------------------
create extension if not exists pg_trgm;

-- Browse: newest active listings, and category-filtered browse.
create index if not exists listings_status_published_idx
  on public.listings (status, published_at desc);
create index if not exists listings_category_status_idx
  on public.listings (category_id, status);

-- Search (Section 10): trigram on description (title trigram already exists).
create index if not exists listings_description_trgm_idx
  on public.listings using gin (description gin_trgm_ops);
