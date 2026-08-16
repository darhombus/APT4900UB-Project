-- ============================================================================
-- ADM-17 — AN ADMIN IS STAFF, NOT A MARKETPLACE PARTICIPANT
-- (ADM-17 PRD, Section 2 — database closures ADM-18, ADM-20, ADM-22, ADM-32)
--
-- PRODUCT RULING (ADM-17): an admin may DISCHARGE existing obligations; an
-- admin may not CREATE new marketplace state. This migration closes the three
-- creation paths that the ADM-17 Section 1 survey found open at the database.
--
-- The survey's finding was that four of five participant capabilities were
-- admitted at BOTH the policy layer and the app layer — an admin was not
-- blocked by a hidden button, because there was no hidden button. Boosts were
-- already closed (ADM-24: `boosts` has RLS enabled AND FORCED with no INSERT
-- policy at all, so every authenticated INSERT is refused irrespective of
-- grants) and are deliberately untouched here.
--
-- This extends BST-19's mechanism rather than adding a second layer to an
-- already-closed door. The column-grant survey established that `authenticated`
-- holds column-level INSERT on all thirteen `listings` columns including
-- `seller_id`, so BST-19's with_check is the SOLE thing refusing admin listing
-- creation — live enforcement, not belt-and-braces. The three closures below
-- stand in exactly the same position, and must be written with the same care.
--
-- DELIBERATE ASYMMETRIES, recorded so a later phase does not "tidy" them:
--   ADM-19  complete_order and cancel_pending_order are UNCHANGED. A legacy
--           order must be able to reach a terminal state. An admin may finish
--           what exists; they may not start something new.
--   ADM-21  messages_insert is UNCHANGED. Its closure is DERIVATIVE: sending
--           requires being a conversation participant, and ADM-20 below plus
--           BST-19 prevent an admin from becoming one. A legacy admin already
--           holding a conversation can still reply — that is discharge.
--   ADM-22  reviews_delete is UNCHANGED. Deletion removes state; it does not
--           create it.
--   ADM-23  NO *_select policy is narrowed anywhere. BST-22 holds: the admin
--           read arms are containment, not reach. Narrowing any of them blinds
--           /admin, which is the surface this whole phase exists to protect.
-- ============================================================================


-- ---- ADM-18 — create_pending_order -----------------------------------------
-- CREATE OR REPLACE, NEVER DROP + CREATE.
--
-- The hazard is privilege WIDENING, not privilege loss. Section 1 confirmed
-- pg_default_acl for schema public / objtype f grants EXECUTE to postgres,
-- anon, authenticated AND service_role:
--
--   {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--
-- This function's live proacl is {postgres=X/postgres,authenticated=X/postgres},
-- so anon and service_role were explicitly revoked at some point. A DROP would
-- not lose `authenticated` — the default ACL re-grants it — it would silently
-- RESTORE anon and service_role, exposing a SECURITY DEFINER function on the
-- payment path to unauthenticated callers, arriving with no diff to notice.
--
-- The acceptance criterion is therefore BYTE-IDENTICAL proacl. "authenticated
-- still has EXECUTE" would read green while missing the widening entirely.
-- No GRANT is re-asserted below: CREATE OR REPLACE preserves the ACL, and
-- re-asserting one would mask exactly the regression we are guarding against.
--
-- SET search_path = public is RE-DECLARED deliberately. CREATE OR REPLACE
-- replaces proconfig wholesale; omitting it would strip search_path pinning
-- from a SECURITY DEFINER function, which is a privilege-escalation surface.
--
-- The body is byte-for-byte the surveyed body plus three lines. Nothing is
-- reformatted, no variable renamed, the declare-block alignment is preserved,
-- and the unique_violation handler and the round(...)::bigint line and its
-- comment are untouched. A "cleaned up" rewrite here would be an unreviewed
-- change to the payment path.
--
-- GUARD PLACEMENT. The three new lines sit immediately after the
-- not_authenticated check, abutting it with no intervening blank line. That
-- matches this function's own established style — consecutive guards abut
-- (see listing_not_found / listing_not_active / own_listing below), and a
-- blank line separates a guard block from a non-guard statement (the `select`
-- that follows). Placing it here is also what ADM-18 specifies: "immediately
-- after the not_authenticated check and before the listing lookup". It is a
-- property of the CALLER, not of the listing, and is the cheapest check
-- available, so it runs before the listing is read.
--
-- ERRCODE P0001 is correct and not arbitrary: 42501 is reserved in this
-- codebase for not_authenticated alone; every business-rule refusal
-- (listing_not_found excepted, which is P0002) raises P0001.
--
-- NO user-facing error mapping is added (ADM-31). Section 1 confirmed
-- 'admin_cannot_purchase' contains none of the three substrings checkout.ts
-- matches on, so it falls to the existing generic 400 fallback — never a 500.
-- With ADM-26 removing the Buy now button, the only route to this error is a
-- crafted request, and a specific message would be information disclosure to
-- exactly the caller who should learn nothing.
create or replace function public.create_pending_order(p_listing_id uuid, p_reference text)
returns public.orders
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_listing    record;
  v_order      public.orders;
  v_constraint text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if public.is_admin() then
    raise exception 'admin_cannot_purchase' using errcode = 'P0001';
  end if;

  select id, seller_id, status, price
    into v_listing
    from public.listings
   where id = p_listing_id;

  if not found then
    raise exception 'listing_not_found' using errcode = 'P0002';
  end if;
  if v_listing.status <> 'active' then
    raise exception 'listing_not_active' using errcode = 'P0001';
  end if;
  if v_listing.seller_id = v_uid then
    raise exception 'own_listing' using errcode = 'P0001';
  end if;

  begin
    insert into public.orders (listing_id, buyer_id, seller_id, amount_total, paystack_reference)
    values (
      p_listing_id,
      v_uid,
      v_listing.seller_id,
      -- price is numeric(12,2), so this is exact: no float, no drift (D8).
      round(v_listing.price * 100)::bigint,
      p_reference
    )
    returning * into v_order;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'orders_one_pending_per_listing' then
        raise exception 'listing_on_hold' using errcode = 'P0001';
      end if;
      raise;
  end;

  return v_order;
end;
$$;


-- ---- ADM-20 — conversations_insert -----------------------------------------
-- BEFORE (live, captured for the diff):
--   roles      {authenticated}
--   cmd        INSERT
--   qual       (null)        -- INSERT policies have no USING clause
--   with_check ((buyer_id = auth.uid()) AND (EXISTS ( SELECT 1
--                 FROM listings l
--                WHERE ((l.id = conversations.listing_id)
--                  AND (l.status = 'active'::listing_status)
--                  AND (l.seller_id = conversations.seller_id)
--                  AND (l.seller_id <> auth.uid())))))
--
-- AFTER: every existing term unchanged and in the same order, with
-- AND NOT public.is_admin() appended.
--
-- THIS POLICY ONLY. conversations_update is live and is backed by a
-- COLUMN-LEVEL UPDATE grant that table-level instruments cannot see
-- (has_table_privilege UPDATE = false, has_any_column_privilege UPDATE = true
-- for `authenticated` — the one such pair the Section 1 sweep found). It drives
-- conversation read-marking; dropping or altering it would silently break the
-- unread count for every user. conversations_select is untouched per ADM-23.
drop policy if exists conversations_insert on public.conversations;

create policy conversations_insert on public.conversations
  for insert to authenticated
  with check (
    buyer_id = auth.uid()
    and exists (
      select 1
        from listings l
       where l.id = conversations.listing_id
         and l.status = 'active'::listing_status
         and l.seller_id = conversations.seller_id
         and l.seller_id <> auth.uid()
    )
    and not public.is_admin()
  );

comment on policy conversations_insert on public.conversations is
  'Starting a conversation is a marketplace-participant capability, closed to '
  'admins by ADM-20. The operative rule (ADM-17): an admin may discharge '
  'existing obligations but may not create new marketplace state. The '
  'NOT is_admin() conjunct is what refuses them; every other term is the '
  'pre-existing ownership and active-listing check, unchanged. ADM-21 leaves '
  'messages_insert alone deliberately — its closure is DERIVATIVE, because '
  'sending requires being a participant and this policy plus BST-19 prevent an '
  'admin from becoming one. A legacy admin already holding a conversation can '
  'still reply, which is discharge, not creation.';


-- ---- ADM-22 — reviews_insert -----------------------------------------------
-- BEFORE (live, captured for the diff):
--   roles      {authenticated}
--   cmd        INSERT
--   qual       (null)
--   with_check ((buyer_id = auth.uid()) AND (EXISTS ( SELECT 1
--                 FROM orders o
--                WHERE ((o.id = reviews.order_id)
--                  AND (o.buyer_id = auth.uid())
--                  AND (o.status = 'completed'::order_status)))))
--
-- AFTER: every existing term unchanged and in the same order, with
-- AND NOT public.is_admin() appended.
--
-- WHY REVIEW IS REFUSED WHERE COMPLETION IS PERMITTED (ADM-22 vs ADM-19).
-- This is the sharpest edge of the discharge/create distinction, and it is
-- recorded so a later phase does not reconcile it for symmetry. Completing an
-- order discharges an obligation and moves it to a terminal state. A review
-- CREATES new public state that moves a seller's rating — and the rating
-- surface is load-bearing as this marketplace's primary anti-disintermediation
-- incentive. A staff-authored review also carries implicit platform authority.
-- Holding a legacy completed order does not license writing one.
--
-- reviews_delete and reviews_select are untouched. There is no reviews_update
-- policy — the seller-response path is the submit_seller_response SECURITY
-- DEFINER RPC — and none is created here.
drop policy if exists reviews_insert on public.reviews;

create policy reviews_insert on public.reviews
  for insert to authenticated
  with check (
    buyer_id = auth.uid()
    and exists (
      select 1
        from orders o
       where o.id = reviews.order_id
         and o.buyer_id = auth.uid()
         and o.status = 'completed'::order_status
    )
    and not public.is_admin()
  );

comment on policy reviews_insert on public.reviews is
  'Writing a review is a marketplace-participant capability, closed to admins '
  'by ADM-22. The operative rule (ADM-17): an admin may discharge existing '
  'obligations but may not create new marketplace state. This is the sharpest '
  'edge of that distinction — ADM-19 deliberately lets a legacy admin COMPLETE '
  'an order, while this policy refuses them the review that would follow. '
  'Completion moves an order to a terminal state; a review CREATES new public '
  'state that moves a seller rating, and the rating surface is load-bearing as '
  'the primary anti-disintermediation incentive. A staff-authored review also '
  'carries implicit platform authority. reviews_delete is unchanged: deletion '
  'removes state rather than creating it.';


-- ---- ADM-32 — the promotion note lives in the catalog ----------------------
-- ADM-30 requires seller-side wind-down BEFORE a seller is promoted to admin:
-- no active listings, no in-flight orders as seller, no pending payouts. That
-- is a procedural obligation, and procedural obligations need a home that the
-- person carrying them out will actually encounter.
--
-- This project's PRDs are gitignored and local-only, so a PRD is not that home.
-- Someone promoting a user runs SQL against public.profiles — role is set only
-- by SQL or service role, since profiles_update pins `role` to its current
-- value and `authenticated` holds no column grant on it. The catalog is
-- therefore the one place the note is guaranteed to be seen.
--
-- Section 1 confirmed col_description on this column is NULL, so this creates
-- rather than overwrites.
comment on column public.profiles.role is
  'Set only by SQL or service role. Promotion to admin (ADM-30) requires '
  'seller-side wind-down FIRST: no active listings, no in-flight orders as '
  'seller, no pending payouts. /sell is closed to admins (ADM-25), so any '
  'seller-side state an admin holds has no route and can only be reached '
  'via service role.';
