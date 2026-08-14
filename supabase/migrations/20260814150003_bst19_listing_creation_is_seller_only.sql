-- ============================================================================
-- BST-19 — LISTING CREATION IS A SELLER CAPABILITY ONLY
-- (Admin Dashboard PRD — ratified alongside Sections 2/3 and BST-18)
--
-- PRODUCT RULING: admins are not supposed to be able to create listings.
-- This is the concrete resolution of SP-17's admin-listings question.
--
-- The shipped policy admitted admins through BOTH of its arms, which is why
-- "remove the OR is_admin()" was not sufficient:
--
--   with_check (((seller_id = auth.uid()) AND is_seller_or_admin()) OR is_admin())
--                                           ^^^^^^^^^^^^^^^^^^^^^      ^^^^^^^^^^
--                                           arm 1: an admin inserting  arm 2: an
--                                           under their OWN uid        admin
--                                                                      inserting
--                                                                      under ANY
--                                                                      seller_id
--
-- Arm 2 is the wider hole — it does not constrain seller_id at all, so an admin
-- could create a listing attributed to any seller on the platform. Removing arm
-- 2 alone would still leave arm 1. The role predicate itself has to become
-- seller-only, which is what this migration does.
--
-- CONSEQUENCE, INTENDED: profiles.role is a single-valued enum
-- (buyer | seller | admin), so an admin can never simultaneously hold 'seller'.
-- This excludes admins from listing creation ABSOLUTELY, not merely from
-- creating on behalf of others.
--
-- SCOPE. INSERT only. listings_update is untouched (Section 2 already narrowed
-- it to seller_id = auth.uid() AND status <> 'removed'), and existing
-- admin-owned rows — if any exist on a tier — keep working: they remain
-- readable, and updatable by their owner, because listings_update keys on
-- seller_id, not on role. Closing creation does not delete what already exists.
--
-- is_seller_or_admin() IS DELIBERATELY LEFT ALONE. Other policies still use it;
-- this migration adds a narrower predicate rather than redefining a shared one.
-- ============================================================================


-- ---- The seller-only predicate ---------------------------------------------
-- Shaped exactly like its two siblings (rls_policies.sql:16-23 and the
-- become_seller phase's is_seller_or_admin): SQL, STABLE, SECURITY DEFINER,
-- explicit safe search_path.
--
-- SECURITY DEFINER is load-bearing, not stylistic. An inline
-- `exists (select 1 from public.profiles where id = auth.uid() and role = 'seller')`
-- written directly into the policy would be subject to profiles' OWN RLS. It
-- would work today only because profiles_select is `using (true)` — and it would
-- fail CLOSED the moment that policy narrows, silently breaking listing creation
-- for every seller on the platform.
--
-- This is the third instance of that hazard on this project: the inline-join
-- lesson at 20260721150000:194-200, dispute_party() at 20260814131500, and now
-- here. Running as owner tests the caller's real role rather than the caller's
-- RLS view of their own profile row.
create or replace function public.is_seller()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'seller'
  );
$$;

comment on function public.is_seller() is
  'True when the caller''s profile role is exactly ''seller'' (BST-19). '
  'Distinct from is_seller_or_admin(), which is retained unchanged for the '
  'policies that legitimately admit both. SECURITY DEFINER so the predicate '
  'reads the caller''s true role rather than their RLS view of profiles.';

-- Revoke-then-grant. The two sibling helpers still carry Postgres's default
-- PUBLIC execute (rls_policies.sql:69 granted without revoking first); this one
-- follows the later standard set by payout_sweep_candidates and dispute_party
-- instead, so PUBLIC never holds it.
--
-- `authenticated` only. anon is deliberately excluded: the policy below is
-- scoped `to authenticated`, and anon holds no INSERT privilege on listings in
-- any case. service_role is excluded because it holds BYPASSRLS and never
-- evaluates this policy.
revoke all on function public.is_seller() from public, anon, authenticated, service_role;
grant execute on function public.is_seller() to authenticated;


-- ---- The policy ------------------------------------------------------------
-- BEFORE (live, captured for the diff):
--   roles      {authenticated}
--   cmd        INSERT
--   qual       (null)        -- INSERT policies have no USING clause; correct
--   with_check (((seller_id = auth.uid()) AND is_seller_or_admin()) OR is_admin())
--
-- AFTER: one conjunction, no admin arm in either position. A caller must be
-- inserting under their own uid AND hold the seller role.
drop policy if exists listings_insert on public.listings;

create policy listings_insert on public.listings
  for insert to authenticated
  with check (
    seller_id = auth.uid()
    and public.is_seller()
  );

comment on policy listings_insert on public.listings is
  'Listing creation is a seller capability only (BST-19). Both the seller_id '
  'ownership check and the seller-only role predicate must hold; there is no '
  'admin arm in either position. Resolves SP-17''s admin-listings question.';
