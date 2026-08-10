-- ============================================================================
-- PROFILES WRITE SURFACE — column-scoped UPDATE allowlist
-- (Boosts PRD — BST-16)
--
-- The sibling of BST-15, which did this for `listings` in
-- 20260810120000_boosts_schema.sql. Same hole, same mechanism, different table —
-- and a separate migration because it is a separate concern: nothing here is
-- about boosts.
--
-- THE EXPOSURE, verified on the local stack before this migration:
--
--   profiles | authenticated | DELETE, INSERT, REFERENCES, SELECT, TRIGGER,
--                              TRUNCATE, UPDATE
--
-- That table-level UPDATE comes from the blanket grant at
-- 20260710015112_rls_policies.sql:59, and `profiles_update` permits a user to
-- update their own row. Table-level UPDATE covers EVERY column, including the
-- two the reviews phase added years later. So this is a valid request from any
-- authenticated user against their own profile:
--
--     patch /rest/v1/profiles?id=eq.<self>
--     { "review_count": 2000, "rating_sum": 9999 }
--
-- — a seller forging their own displayed reputation. The seller profile page,
-- the listing page's seller block and every seller card read those two columns
-- to render a star average, so the forged figure is what buyers would see. It
-- also feeds nothing in the search ORDER BY today (that reads the LISTING's
-- aggregates, closed by BST-15), which is precisely why this one could have sat
-- unnoticed indefinitely: it is a display lie, not a ranking lie, and nothing
-- would ever have thrown.
--
-- WHAT IS NOT THE HOLE. `role` is already pinned, by the WITH CHECK half of
-- profiles_update:
--
--     (auth.uid() = id) and (role = (select role from profiles where id = auth.uid()))
--
-- so self-promotion to 'admin' has always been refused. Excluding `role` from
-- the grant below adds a second, independent gate in front of that policy —
-- privilege as well as policy — and costs nothing: `become_seller()` is
-- SECURITY DEFINER and writes past both, exactly as it was designed to.
-- ============================================================================

-- REVOKE then GRANT, per the standing pattern. Revoking the table-level
-- privilege also clears it for every column, so the enumeration below is the
-- whole of what `authenticated` may write afterwards.
revoke update on public.profiles from authenticated;

-- The two columns the account profile form actually writes
-- (src/routes/(protected)/account/profile/+page.server.ts: full_name at the
-- save action, avatar_url after an upload). A column absent from this list
-- fails 42501 — loud, and the safe direction for anything added later.
grant update (
  full_name,
  avatar_url
) on public.profiles to authenticated;

-- WHAT IS DELIBERATELY ABSENT, AND WHY:
--
--   review_count, rating_sum  the exposure above. Maintained by the reviews
--                             phase's SECURITY DEFINER trigger, which is
--                             unaffected by this grant.
--   role                      already pinned by the profiles_update WITH CHECK;
--                             excluded here so privilege and policy both refuse
--                             it. become_seller() is SECURITY DEFINER.
--   id                        identity; a user reassigning it is meaningless at
--                             best and a collision at worst.
--   created_at                historical fact.
--   updated_at                set by the profiles_updated_at BEFORE trigger.
--                             Column privileges are checked against the
--                             statement's target list, not against what a
--                             trigger assigns, so the trigger keeps working
--                             without the grant.
--
-- service_role keeps table-level UPDATE untouched: handle_new_user, the reviews
-- aggregate trigger and the e2e fixtures' promoteToSeller all continue to work
-- unchanged. `anon` never held UPDATE at all (:58 grants it SELECT only).
