-- ============================================================================
-- BST-22 — ADMIN RLS ARMS, ORPHAN DROP, AND FUNCTION EXECUTE TIGHTENING
-- (Admin Dashboard PRD — ratified alongside Section 5)
--
-- Three concerns, one migration:
--   (i)   admin arms on boosts_select and reviews_select
--   (ii)  drop the orphaned is_seller_or_admin()
--   (iii) revoke default PUBLIC EXECUTE from four SECURITY DEFINER functions
-- ============================================================================


-- ---- (i) ADMIN ARMS -------------------------------------------------------
-- An admin arm does not widen what an admin can already reach: /admin reads
-- these tables, and is_admin() is true for that caller either way. What it buys
-- is GATE-REGRESSION CONTAINMENT. Section 5 had to read both tables with
-- createSupabaseAdmin() because neither policy admits an admin — and a
-- service-role read means a regression in the /admin layout gate leaks the whole
-- table. With the session client and an admin arm, the same regression still
-- meets an RLS refusal. ADM-2 made the layout the single GATE, not the only
-- layer.
--
-- EACH POLICY'S `to` CLAUSE IS PRESERVED EXACTLY. They differ, and normalising
-- them to one form would be an unrequested semantic change that announces
-- itself nowhere:
--   boosts_select   roles={public}              -> no `to` clause (PUBLIC default)
--   reviews_select  roles={anon,authenticated}  -> `to anon, authenticated`
--
-- Every existing predicate is preserved verbatim; `or public.is_admin()` is the
-- only addition to either.

-- BEFORE: for select, roles={public}
--           using (seller_id = auth.uid())
-- AFTER:  same role scope, same predicate, plus the admin arm.
drop policy if exists boosts_select on public.boosts;

create policy boosts_select on public.boosts
  for select
  using (
    seller_id = auth.uid()
    or public.is_admin()
  );

comment on policy boosts_select on public.boosts is
  'A seller reads their own boosts; an admin reads all (BST-22). The admin arm '
  'exists so /admin/boosts can use the session client and keep RLS as a layer '
  'behind the layout gate, rather than reading with service_role.';

-- BEFORE: for select, roles={anon,authenticated}
--           using ((status = 'visible') or (buyer_id = auth.uid()))
-- AFTER:  same role scope, both predicates verbatim, plus the admin arm.
--
-- The author carve-out stays exactly as it was: `buyer_id = auth.uid()` is why a
-- review's AUTHOR still sees it after moderation hides it, and the reviews-phase
-- RLS spec pins that ("not even the seller sees a hidden review — the carve-out
-- is for AUTHORS"). None of that spec's four identities is an admin, so this arm
-- never fires for them and the assertion keeps discriminating.
drop policy if exists reviews_select on public.reviews;

create policy reviews_select on public.reviews
  for select to anon, authenticated
  using (
    status = 'visible'
    or buyer_id = auth.uid()
    or public.is_admin()
  );

comment on policy reviews_select on public.reviews is
  'Public reads visible reviews; an author reads their own even when hidden; an '
  'admin reads all (BST-22, so /admin/reviews can see what it must restore).';


-- ---- (ii) DROP THE ORPHAN -------------------------------------------------
-- is_seller_or_admin() lost its last consumer when BST-19 replaced
-- listings_insert's predicate with is_seller(). Orphaning confirmed three times
-- against live catalog state: no policy references it, no function body
-- references it, and the only textual hits in the repo are a generated type that
-- regenerates away, two historical comments in test files, and a CLI cache
-- artifact.
--
-- BST-20 did not bring back a need for it: every capability check that admits an
-- admin (the sell/* entry guards) is TypeScript reading profiles.role, not a SQL
-- predicate. Dropping now rather than later avoids leaving a PUBLIC-executable
-- SECURITY DEFINER function standing with nothing calling it.
drop function if exists public.is_seller_or_admin();


-- ---- (iii) EXECUTE TIGHTENING ---------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default. rls_policies.sql:69 and its
-- successors granted to the roles that needed it WITHOUT revoking that default
-- first, so PUBLIC has been carrying EXECUTE on these four ever since — the
-- function-level shape of exactly what BST-17 and BST-18 closed on tables.
--
-- SAFE BECAUSE EVERY ROLE THAT NEEDS EXECUTE ALREADY HOLDS IT EXPLICITLY,
-- verified per function before writing this. That mattered most for is_admin:
-- seven policies with roles={public} evaluate it on every anonymous browse
-- (conversations_select, listing_images_select, listings_select,
-- messages_select, orders_select, payout_recipients_select, payouts_select), so
-- anon really does execute it — and anon holds its own grant. Revoking PUBLIC
-- from a function anon relied on through PUBLIC alone would have broken
-- anonymous browsing outright.
--
-- Revoke-then-grant: each explicit grant is re-asserted rather than assumed to
-- survive `revoke ... from public`.
--
-- soft_delete_listing is the one MUTATION in the set. Its in-body
-- `seller_id = auth.uid()` means anon matches nothing, but "a guard elsewhere
-- makes it safe" is the reasoning this phase has been closing, not relying on.
-- Verified before revoking: every .rpc() call to it is made through a SESSION
-- client (listings.ts:350 and three seller-client test sites), never through
-- createSupabaseAdmin(), so service_role needs no grant.
--
-- ── THE REVOKE SCOPE IS DELIBERATELY WIDER THAN LOCAL STATE ─────────────────
-- LOCAL AND HOSTED GRANTS DIVERGE ON THESE FOUR, AND HOSTED IS A SUPERSET.
-- Supabase's project template grants EXECUTE on functions to anon,
-- authenticated and service_role before any migration runs. `db reset` replays
-- migrations only, so it never reproduces that baseline — an ACL asserted from
-- a local reset says nothing about hosted. Verified on hosted at authoring
-- time:
--
--   soft_delete_listing          local: authenticated
--                                hosted: anon, authenticated, service_role
--   is_admin                     hosted adds service_role
--   is_conversation_participant  hosted adds service_role
--   conversation_is_sendable     hosted adds anon
--
-- Objects created after this project's revoke-then-grant discipline began
-- (is_seller, dispute_party, the ADM RPCs) match on both tiers, which is what
-- identifies the above as template residue rather than drift.
--
-- So `revoke ... from public, anon, authenticated, service_role` is NOT
-- redundant belt-and-braces against the local ACL: on hosted it REMOVES FOUR
-- REAL GRANTS. That tightening is INTENDED, and each removal was checked
-- against the live catalog rather than assumed:
--
--   soft_delete_listing         loses anon         — the point of this section
--                               loses service_role — no createSupabaseAdmin()
--                                                    .rpc() caller exists
--   is_admin                    loses service_role ┐ service_role is BYPASSRLS,
--   is_conversation_participant loses service_role ┘ so it NEVER evaluates an
--                                                    RLS predicate, and neither
--                                                    has any .rpc() caller
--   conversation_is_sendable    loses anon         — referenced by exactly one
--                                                    policy, messages_insert,
--                                                    whose scope is
--                                                    roles={authenticated}.
--                                                    anon cannot reach it.
--
-- WHAT anon KEEPS, AND WHY IT IS LOAD-BEARING. is_conversation_participant is
-- also referenced by messages_select (roles={public}) and is_admin by eight
-- policies including seven roles={public} ones, so an anonymous request really
-- does execute both. Their anon grants are re-asserted below; dropping either
-- would break anonymous browsing outright with 42501, not degrade it.
-- INTENDED POST-MIGRATION ACL, identical on every tier. proacl always also
-- carries the owner (postgres=X/postgres); the roles named here are the runtime
-- ones.
--
--   soft_delete_listing(uuid)          authenticated
--   is_admin()                         anon, authenticated
--   is_conversation_participant(uuid)  anon, authenticated
--   conversation_is_sendable(uuid)     authenticated, service_role

revoke all on function public.soft_delete_listing(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.soft_delete_listing(uuid) to authenticated;

revoke all on function public.is_admin()
  from public, anon, authenticated, service_role;
grant execute on function public.is_admin() to anon, authenticated;

revoke all on function public.is_conversation_participant(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.is_conversation_participant(uuid) to anon, authenticated;

-- service_role is KEPT here alone among the four, and for a different reason
-- than the others are dropped. This grant is not template residue: it was
-- written deliberately by messaging_schema.sql:217 (`to authenticated,
-- service_role`), so it is part of the SURVEYED set this migration re-asserts
-- verbatim. Removing it would be re-litigating an earlier phase's decision
-- under cover of a grant-hygiene migration, which is not what this is for.
--
-- It is very likely unnecessary — there is no .rpc() caller anywhere, so no
-- client of any kind reaches it directly, and the function is used only inside
-- messages_insert. Recorded as a follow-up rather than acted on here.
revoke all on function public.conversation_is_sendable(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.conversation_is_sendable(uuid) to authenticated, service_role;

-- DELIBERATELY UNTOUCHED: messages_touch_conversation, reviews_apply_aggregates
-- and reviews_verify_denormalization carry a NULL ACL (PUBLIC by default), but
-- they return `trigger` and Postgres refuses them outright — verified:
-- `ERROR: trigger functions can only be called as triggers`. There is nothing to
-- close, and revoking would add noise without removing reach.
