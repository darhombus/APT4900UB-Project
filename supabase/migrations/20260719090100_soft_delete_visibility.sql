-- ============================================================================
-- HIDE SOFT-DELETED LISTINGS FROM EVERY READ SURFACE (Section 6, amended D1)
--
-- A `deleted` listing must be invisible to EVERYONE, including its owner — unlike
-- a draft, which the owner still previews. This widens the exclusion in the two
-- SELECT policies:
--   - listings_select:        owner sees their own rows EXCEPT deleted ones
--   - listing_images_select:  same, for a listing's images
-- Admins keep full visibility (moderation). Public grids (home / category /
-- search) already filter to status='active', and the seller's management view
-- runs as the owner — so excluding `deleted` from the owner's SELECT here removes
-- it from the management tabs automatically (there is no Deleted tab this phase).
--
-- INSERT / UPDATE / DELETE policies are unchanged: the existing listings_update
-- policy already lets an owner UPDATE their own row (that's the soft-delete path),
-- and listings_delete stays drafts-only (the hard-delete path). Idempotent:
-- each policy is dropped and recreated.
-- ============================================================================

drop policy if exists listings_select on public.listings;
create policy listings_select on public.listings
  for select using (
    status in ('active', 'sold')
    or (seller_id = auth.uid() and status <> 'deleted')
    or public.is_admin()
  );

drop policy if exists listing_images_select on public.listing_images;
create policy listing_images_select on public.listing_images
  for select using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id
        and (
          l.status in ('active', 'sold')
          or (l.seller_id = auth.uid() and l.status <> 'deleted')
        )
    )
    or public.is_admin()
  );

-- ---- Soft-delete RPC -------------------------------------------------------
-- Soft-delete a listing the caller owns (active/paused/sold → deleted). SECURITY
-- DEFINER so the UPDATE isn't subject to the SELECT policy above, which (correctly)
-- hides the resulting `deleted` row from its owner — a plain UPDATE would fail
-- PostgREST's returned-row check with 42501. Ownership and the valid from-status
-- are enforced HERE via auth.uid(); returns true only if a row was soft-deleted.
create or replace function public.soft_delete_listing(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  update public.listings
    set status = 'deleted'
    where id = p_id
      and seller_id = auth.uid()
      and status in ('active', 'paused', 'sold');
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

grant execute on function public.soft_delete_listing(uuid) to authenticated;
