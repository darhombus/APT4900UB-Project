-- ============================================================================
-- BST-17 — RETIRE THE BLANKET UPDATE GRANT TO `authenticated`
-- (Admin Dashboard PRD — Section 2; rulings BST-17, ADM-6, ADM-10)
--
-- 20260710015112_rls_policies.sql:58-60 handed data privileges to all three
-- roles table-wide, in one block:
--
--   58: grant select                         ... to anon;          -- SELECT-only
--   59: grant select, insert, update, delete ... to authenticated; -- <-- BST-17
--   60: grant select, insert, update, delete ... to service_role;  -- LOAD-BEARING
--
-- Line 59 is the target of this migration. Line 58 is SELECT-only and out of
-- scope. Line 60 is what every server-side write runs on — checkout
-- finalisation, payout status transitions, notification inserts — and is
-- deliberately left exactly as it stands. Nothing below touches anon or
-- service_role.
--
-- `grant ... on all tables in schema public` binds only the tables that existed
-- when it ran: profiles, categories, listings, listing_images, conversations,
-- messages, orders, payments, payouts, reviews. Every table added since
-- (payout_recipients, boosts, boost_packages, profiles_private, notifications)
-- carries its own revoke-then-grant and is not in scope here.
--
-- Six of those ten were already closed by later phases:
--   payments    revoked outright        rls_policies.sql:65
--   orders      SELECT only             20260730140000:47,54
--   payouts     SELECT only             20260731100000:180,188
--   reviews     select/insert/delete    20260805120000:373,381
--   listings    column allowlist        20260810120000:495-509
--   profiles    column allowlist        20260810140000:46-56
--
-- This migration closes the remaining four, then closes the ADM-10 takedown
-- hole that the listings allowlist leaves open.
--
-- REVOKE-THEN-GRANT throughout. Revoking the table-level privilege also clears
-- every column-level privilege it implied, so each GRANT below is the whole of
-- what `authenticated` may write afterwards — never an addition to an unknown
-- prior state.
-- ============================================================================


-- ---- 1. categories (BST-17) ------------------------------------------------
-- Revoked outright: no client write path exists, now or planned.
--
-- categories_update is `using (public.is_admin())` (rls_policies.sql:97-98), so
-- RLS already refused every non-admin session client. What the grant still
-- allowed was an ADMIN session client writing any column of any category. Under
-- ADM-7 admin mutations run through SECURITY DEFINER RPCs, which execute as the
-- function owner and need no client privilege at all.
revoke update on public.categories from authenticated;


-- ---- 2. listing_images (BST-17) --------------------------------------------
-- Revoked outright. Verified before revoking, as the section required: the app
-- never UPDATEs this table. Every call site is a select, an insert or a delete —
-- listings.ts:123, listings.ts:328, listings.ts:361, search.ts:63, and the two
-- route loads (sell/listings/[id]/edit/+page.server.ts:24,
-- listings/[id]/+page.server.ts:38). Reordering is done by delete-and-reinsert,
-- so even `position` is never written in place.
revoke update on public.listing_images from authenticated;


-- ---- 3. conversations (BST-17) ---------------------------------------------
-- The one legitimate client write here is a participant moving their OWN
-- last-read timestamp. Until now that was enforced by the
-- conversations_guard_update trigger alone (20260721150000:120-148): the policy
-- admits the row, and the trigger raises if anything else changed. This converts
-- the column half of that protection into privilege — the project's standing
-- preference for privilege over trigger (20260810120000:490-491).
--
-- THE ALLOWLIST IS DERIVED FROM THE TRIGGER, NOT CHOSEN. The trigger raises when
-- any of id, listing_id, buyer_id, seller_id, created_at or last_message_at is
-- distinct from its old value. The table has exactly eight columns, so the two
-- below are precisely what it leaves writable.
--
-- THE TRIGGER STAYS IN PLACE. Column privileges cannot express the other half of
-- what it enforces — "a buyer may move buyer_last_read_at but NOT
-- seller_last_read_at, and vice versa". That rule is per-caller, not per-column,
-- and remains the trigger's job. This migration narrows the column surface; it
-- does not replace the trigger.
revoke update on public.conversations from authenticated;

grant update (
  buyer_last_read_at,
  seller_last_read_at
) on public.conversations to authenticated;


-- ---- 4. messages (BST-17) --------------------------------------------------
-- REVOKED OUTRIGHT — no grant follows, and that is a deliberate correction to
-- the Section 2 skeleton, which called for `grant update (read_at)`.
--
-- Two independent reasons that grant could not stand:
--
--   (a) There is no messages_update policy to grant alongside. The skeleton
--       cited rls_policies.sql:196-201, which is the ORIGINAL setup-phase
--       policy; the messaging phase later dropped it (20260721150000:229-232)
--       under D6 — "messages are immutable — no UPDATE (or DELETE) policy under
--       any scoping. The shipped read_at UPDATE policy is removed; read tracking
--       lives on the conversation row." Live pg_policies confirms only
--       messages_insert and messages_select exist.
--
--   (b) public.messages has no read_at column. Its columns are id,
--       conversation_id, sender_id, body, created_at. `grant update (read_at)`
--       would have failed outright: column "read_at" of relation "messages"
--       does not exist.
--
-- Read tracking is the two conversation columns granted in item 3 above, which
-- is where D6 moved it. With no UPDATE policy, RLS already refuses every client
-- UPDATE; revoking turns that silent zero-row result into a hard 42501, exactly
-- as `payments` is treated (rls_policies.sql:62-65).
revoke update on public.messages from authenticated;


-- ---- 5. ADM-10 — a seller cannot leave or enter `removed` ------------------
-- The real takedown hole, and the reason this migration is sequenced ahead of
-- any ADM schema (ADM-6).
--
-- `status` sits in the seller column allowlist (20260810120000:497-509) because
-- transitionListing writes it through the SESSION client (listings.ts:406-417)
-- for the ordinary publish/unpublish/relist lifecycle. The legality of each move
-- is decided by planTransition in TypeScript — which means the DATABASE does not
-- constrain WHICH status a seller writes. A seller could PATCH
-- status='removed' -> 'active' straight through PostgREST and undo an admin
-- takedown before ADM-10's admin RPC even exists.
--
-- Closed by narrowing the row scope rather than the column set. Dropping
-- `status` from the allowlist would work too, but it would break every shipped
-- seller transition flow and force them all through a new RPC — real scope,
-- deliberately not taken in this phase (recorded as deferred work in the PRD).
--
-- BEFORE (rls_policies.sql:115-118, defined once and never redefined since —
-- confirmed against live pg_policies):
--   using       (seller_id = auth.uid() or public.is_admin())
--   with check  (seller_id = auth.uid() or public.is_admin())
--
-- AFTER — two deliberate changes, neither of them a transcription slip:
--
--   (a) The `status <> 'removed'` guard is ADDED, on both halves, and the two
--       halves do different jobs. USING reads the OLD row, so a `removed`
--       listing falls out of the seller's update scope entirely — it cannot be
--       escaped. WITH CHECK reads the NEW row, so `removed` is refused as a
--       seller-written target — an admin takedown cannot be impersonated. One
--       without the other leaves half the hole open.
--
--   (b) The `or public.is_admin()` arm is REMOVED, under ADM-7. Every admin
--       mutation now runs through a SECURITY DEFINER RPC, which executes as the
--       function owner; listings is `enable` not `force` RLS, so the owner path
--       bypasses policies regardless and the arm buys nothing. Verified before
--       applying, as the section required: no app code updates a listing as an
--       admin through a session client. Both UPDATE call sites are owner-gated —
--       listings.ts:170 (edit) behind the ownership check at listings.ts:92-94,
--       and listings.ts:413 (transition) behind listings.ts:311. No
--       counterexample found.
drop policy if exists listings_update on public.listings;

create policy listings_update on public.listings
  for update to authenticated
  using       (seller_id = auth.uid() and status <> 'removed')
  with check  (seller_id = auth.uid() and status <> 'removed');

comment on policy listings_update on public.listings is
  'Sellers may update their own listings except while status = ''removed'' '
  '(ADM-10 admin takedown). USING blocks escaping the state; WITH CHECK blocks '
  'entering it. Admin mutations run as SECURITY DEFINER RPCs and bypass this '
  'policy as owner (ADM-7), so no is_admin() arm is needed here.';
