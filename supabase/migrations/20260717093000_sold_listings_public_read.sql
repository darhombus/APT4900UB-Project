-- ============================================================================
-- SOLD LISTINGS ARE PUBLICLY READABLE (Listings PRD — Section 9)
--
-- The public listing detail page keeps a SOLD listing reachable (with a "Sold"
-- badge) rather than 404-ing it. The setup-phase select policies exposed only
-- `active` rows to strangers, so this migration widens SELECT visibility from
-- `active` to `('active','sold')` on listings and, correspondingly, on
-- listing_images. Nothing else changes:
--   - INSERT/UPDATE/DELETE policies are untouched (create/edit/transition rules
--     are unchanged).
--   - Browse grids (home, category, search) still filter to `status = 'active'`
--     in the query layer, so SOLD never leaks into listing grids — it's only
--     reachable by its own detail URL.
--   - Drafts / removed remain owner-or-admin only.
-- Idempotent: each policy is dropped and recreated.
-- ============================================================================

drop policy if exists listings_select on public.listings;
create policy listings_select on public.listings
  for select using (
    status in ('active', 'sold') or seller_id = auth.uid() or public.is_admin()
  );

drop policy if exists listing_images_select on public.listing_images;
create policy listing_images_select on public.listing_images
  for select using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id
        and (l.status in ('active', 'sold') or l.seller_id = auth.uid())
    )
    or public.is_admin()
  );
