-- ============================================================================
-- ADM SCHEMA A — DISPUTES
-- (Admin Dashboard PRD — Section 3; rulings ADM-1, ADM-6, ADM-7)
--
-- ADM-1: disputes attach to ORDERS, are BUYER-INITIATED only, and move through
-- four states: open -> under_review -> resolved_refunded | resolved_rejected.
-- At most one live dispute per order. Seller-initiated disputes are out of
-- scope for this phase and recorded as future work.
--
-- ADM-6: this lands after the BST-17 remediation migration, which is the first
-- migration of the phase. Nothing here deletes orders, so SP-15 stays deferred.
--
-- ADM-7: NO role receives UPDATE or DELETE on this table — not authenticated,
-- not service_role. Every state transition goes through a SECURITY DEFINER RPC
-- in Section 4. The absence of the privilege is the guarantee; the RPCs are the
-- single deliberate exception to it, exactly as `payouts` and
-- transition_payout_status are arranged (20260731110000:108-113).
-- ============================================================================

create table public.disputes (
  id           uuid primary key default gen_random_uuid(),

  -- FK INTO orders. Deliberately NO on-delete clause, so this defaults to NO
  -- ACTION: a disputed order cannot be deleted out from under its dispute.
  -- Deliberately NO FK is added FROM orders in the other direction — SP-15
  -- (the review FK-direction question) stays deferred, and this migration adds
  -- exactly one more inbound blocker for whoever eventually resolves it.
  order_id     uuid not null references public.orders (id),

  -- The buyer who opened it. `restrict` matches orders.buyer_id /
  -- orders.seller_id (20260727170000:52-53): dispute history outlives nothing.
  opened_by    uuid not null references public.profiles (id) on delete restrict,

  reason       text not null check (char_length(reason) between 10 and 2000),

  -- text + CHECK rather than an enum, following the notifications catalog
  -- precedent (20260811150000:21-25): the value list is short, the application
  -- already knows these strings by name, and a CHECK is edited by an ordinary
  -- migration instead of an ALTER TYPE that cannot share a transaction with
  -- other DDL.
  status       text not null default 'open'
                 check (status in ('open', 'under_review',
                                   'resolved_refunded', 'resolved_rejected')),

  -- ADM-3 — refunds are MANUAL this phase. The admin performs the refund in the
  -- Paystack dashboard and records its reference here. There is no Paystack
  -- refund API integration and no Inngest function behind this column.
  refund_reference text,

  resolution_note  text,
  resolved_by      uuid,

  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

comment on table public.disputes is
  'Buyer-initiated order disputes (ADM-1). Status transitions happen ONLY '
  'through the Section 4 SECURITY DEFINER RPCs — no role holds UPDATE or '
  'DELETE (ADM-7). refund_reference is a manual Paystack dashboard reference '
  '(ADM-3), not an API result.';

-- ADM-1 — at most ONE live dispute per order. Partial, so the resolved history
-- accumulates freely: an order may carry many resolved disputes over time but
-- never two that are simultaneously actionable.
create unique index disputes_one_live_per_order
  on public.disputes (order_id)
  where status in ('open', 'under_review');

-- Queue ordering for /admin/disputes (Section 5): open + under_review, newest
-- first.
create index disputes_status_created_idx
  on public.disputes (status, created_at desc);


-- ---- Party check helper ----------------------------------------------------
-- SECURITY DEFINER, and that is load-bearing rather than stylistic.
--
-- An inline `exists (select 1 from public.orders ...)` inside the policy below
-- would itself be subject to orders' RLS. This project has already been bitten
-- by exactly that and documented it at 20260721150000:194-200, where an inline
-- join against listings evaluated false for a legitimate caller because
-- listings_select hid the row from them.
--
-- Here the seller arm would HAPPEN to resolve, because orders_select admits
-- `seller_id = auth.uid()` (rls_policies.sql:207-210). That is luck, not
-- design: it breaks silently the first time orders_select is narrowed, and it
-- would fail closed — a seller quietly unable to see a dispute against them.
-- Running as owner tests the order's true parties, not the caller's visibility
-- of them.
create or replace function public.dispute_party(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
  );
$$;

comment on function public.dispute_party(uuid) is
  'True when the caller is the buyer or the seller on the given order. '
  'SECURITY DEFINER so the disputes SELECT policy tests the order''s real '
  'parties rather than the caller''s RLS view of orders (lesson: '
  '20260721150000:194-200).';

-- Revoke-then-grant: Postgres grants EXECUTE to PUBLIC by default, so granting
-- alone would leave that default in place.
revoke all on function public.dispute_party(uuid) from public, anon, authenticated, service_role;
grant execute on function public.dispute_party(uuid) to authenticated, service_role;


-- ---- Grants (ADM-7) --------------------------------------------------------
-- REVOKE first, then GRANT — this project's default privileges are not a clean
-- slate (rls_policies.sql:52-57), and the standing lesson from
-- 20260730140000:39-45 is that granting alone is silently correct locally and
-- silently wrong hosted.
--
-- The asymmetry IS the design:
--   authenticated  SELECT only          — reads scoped by the policy below
--   service_role   SELECT, INSERT       — the Section 4 RPCs' insert path
--   anon           nothing              — a hard permission error, like payments
--   NOBODY         UPDATE or DELETE     — ADM-7; transitions are RPC-only
--
-- Note that service_role holds BYPASSRLS, so for that role the grants below are
-- the entire access story — the policy never applies to it.
revoke all on public.disputes from anon, authenticated, service_role;

grant select         on public.disputes to authenticated;
grant select, insert on public.disputes to service_role;


-- ---- RLS -------------------------------------------------------------------
-- `force` matches the reviews / boosts / profiles_private precedent. It binds
-- the table owner too — though on this project `postgres` carries BYPASSRLS, so
-- the Section 4 SECURITY DEFINER RPCs are unaffected either way. Enabling it
-- costs nothing and removes a footgun if that role attribute ever changes.
alter table public.disputes enable  row level security;
alter table public.disputes force   row level security;

-- Three arms, per ADM-1's parties plus the admin queue:
--   (a) the buyer who opened it
--   (b) either party on the order (buyer or seller) — via the definer helper
--   (c) admins
--
-- (a) is not redundant with (b): it keeps the opener's own read working even if
-- the order's buyer_id were ever reassigned, and it states the ADM-1 model
-- (buyer-initiated) directly in the policy rather than by implication.
create policy disputes_select on public.disputes
  for select to authenticated
  using (
    opened_by = auth.uid()
    or public.dispute_party(order_id)
    or public.is_admin()
  );

-- No INSERT, UPDATE or DELETE policy, deliberately. INSERT is reachable only by
-- service_role (which bypasses RLS) and by the Section 4 definer RPCs; UPDATE
-- and DELETE are reachable by nobody at all (ADM-7).
