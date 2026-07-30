-- ============================================================================
-- CHECKOUT SCHEMA — orders, payments, and the order state machine
-- (Checkout PRD — Section 2; execution rulings R-1 … R-10)
--
-- `orders`, `payments` and the `order_status` enum already existed from the
-- ERD-derived initial migration, in a cart shape that predates this phase:
-- quantity/unit_price/total_amount as numeric, a transactional `payments` row
-- with an updated_at trigger, and a 7-value order_status carrying `fulfilled`,
-- `disputed` and `refunded`. None of it matches the platform-checkout model.
--
-- Ruling R-1: because all four money tables are empty on every tier (verified
-- local + hosted) and no application code has ever written them, they are
-- DROPPED and RECREATED here rather than ALTERed. Postgres cannot remove enum
-- values, so reaching D5's exact five requires recreating the type regardless.
-- The initial migration is NOT edited — this new migration is the correction.
--
-- Order of operations is load-bearing (R-1):
--   reviews_insert policy → reviews/payouts FKs → payments → orders →
--   order_status → recreate enum → recreate tables → restore FKs + policy.
-- ============================================================================


-- ---- 1. Tear down the dependants, then the tables -------------------------
-- `reviews_insert` reads orders.status = 'completed', so it pins the enum and
-- must go first. It is restored verbatim at step 6.
drop policy if exists reviews_insert on public.reviews;

alter table public.reviews drop constraint if exists reviews_order_id_fkey;
alter table public.payouts drop constraint if exists payouts_order_id_fkey;

-- payments references orders, so it drops first. Both tables take their own
-- indexes, policies and updated_at triggers with them.
drop table if exists public.payments;
drop table if exists public.orders;

drop type if exists public.order_status;


-- ---- 2. The lifecycle enum (D5) ------------------------------------------
-- pending_payment → paid → completed, with pending_payment → cancelled (buyer)
-- and pending_payment → expired (Inngest). completed/cancelled/expired are
-- terminal. No refunds, disputes or partial states in this phase.
create type public.order_status as enum
  ('pending_payment', 'paid', 'completed', 'cancelled', 'expired');


-- ---- 3. ORDERS ------------------------------------------------------------
-- One listing, quantity 1, no cart (D1). Money is bigint KES cents (D8) —
-- Paystack's subunit convention — converted once at creation and stored; no
-- float ever touches it.
create table public.orders (
  id                         uuid primary key default gen_random_uuid(),
  listing_id                 uuid not null references public.listings (id) on delete restrict,
  buyer_id                   uuid not null references public.profiles (id) on delete restrict,
  seller_id                  uuid not null references public.profiles (id) on delete restrict,
  status                     public.order_status not null default 'pending_payment',
  amount_total               bigint not null check (amount_total > 0),
  commission_amount          bigint,
  seller_net                 bigint,
  paystack_reference         text not null unique,
  paystack_authorization_url text,
  created_at                 timestamptz not null default now(),
  paid_at                    timestamptz,
  completed_at               timestamptz,
  cancelled_at               timestamptz,
  expired_at                 timestamptz,
  constraint buyer_is_not_seller check (buyer_id <> seller_id)
);

comment on table public.orders is
  'Platform checkout orders. One listing, quantity 1 (D1). All writes go through '
  'the security-definer functions below or the service-role client — no client '
  'role holds INSERT/UPDATE/DELETE, by policy AND by privilege (R-9).';
comment on column public.orders.seller_id is
  'Denormalised from the listing at creation so the order survives later listing changes.';
comment on column public.orders.amount_total is
  'KES cents (D8). Converted once from listings.price at order creation.';
comment on column public.orders.commission_amount is
  'Null until paid. Set by finalize_order_payment at 5% of amount_total, half up (D7).';
comment on column public.orders.seller_net is
  'Null until paid. amount_total - commission_amount. The payouts phase reads THIS — '
  'nothing recomputes the split later (D7).';
comment on column public.orders.paystack_reference is
  'Our generated reference (msk_ + uuid), not Paystack''s. Unique-indexed: this is '
  'the idempotency key for webhook and callback processing (D10).';

-- D3 — the soft hold. At most one pending order per listing at a time. The
-- server action's check is UX; THIS is the guarantee. Partial, so cancelled /
-- expired / paid orders never block a later attempt.
create unique index orders_one_pending_per_listing
  on public.orders (listing_id)
  where status = 'pending_payment';

create index orders_buyer_idx   on public.orders (buyer_id);
create index orders_seller_idx  on public.orders (seller_id);
create index orders_listing_idx on public.orders (listing_id);


-- ---- 4. PAYMENTS — append-only audit trail (D9) ---------------------------
-- Every webhook event AND every verify response is appended here, valid or not.
-- Rows are never updated or deleted in application code.
create table public.payments (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid references public.orders (id) on delete restrict,
  paystack_reference text,
  event_type         text not null,
  signature_valid    boolean not null,
  payload            jsonb not null,
  processing_outcome text not null,
  provider           text not null default 'paystack',
  created_at         timestamptz not null default now()
);

comment on table public.payments is
  'Immutable Paystack audit trail (D9). Service-role only — no RLS policy and no '
  'grant to any client role. Immutability is enforced by PRIVILEGE, not by trigger '
  '(R-10): service_role holds SELECT/INSERT/DELETE but deliberately NOT UPDATE, so '
  'no code path can rewrite a row. DELETE is granted solely so the e2e teardown '
  'helper can clear test rows ahead of the ON DELETE RESTRICT order FKs (R-5).';
comment on column public.payments.order_id is
  'Nullable on purpose: events can arrive that match no order (probes, replays, '
  'references we never issued).';
comment on column public.payments.event_type is
  'Paystack event name (e.g. charge.success), or ''verify'' for a direct verify snapshot.';
comment on column public.payments.processing_outcome is
  'received | finalized | noop_already_paid | ignored_invalid | ignored_unmatched | '
  'ignored_unhandled | ignored_amount_mismatch | verify_failed';

create index payments_reference_idx on public.payments (paystack_reference);
create index payments_order_idx     on public.payments (order_id);


-- ---- 5. Restore the dependants -------------------------------------------
alter table public.reviews
  add constraint reviews_order_id_fkey
  foreign key (order_id) references public.orders (id) on delete cascade;

alter table public.payouts
  add constraint payouts_order_id_fkey
  foreign key (order_id) references public.orders (id) on delete restrict;


-- ---- 6. RLS ---------------------------------------------------------------
alter table public.orders   enable row level security;
alter table public.payments enable row level security;

-- Readable by the buyer, the seller, or an admin — preserving the admin-read
-- parity the pre-existing policy had (R-1). There are deliberately NO
-- insert/update/delete policies: every state transition happens in a
-- security-definer function or under the service-role client.
create policy orders_select on public.orders
  for select using (
    buyer_id = auth.uid() or seller_id = auth.uid() or public.is_admin()
  );

-- payments: RLS enabled with ZERO policies, and no grant below. Service-role
-- only (D9).


-- ---- 7. Restore reviews_insert verbatim ----------------------------------
-- Unchanged from 20260710015112_rls_policies.sql; 'completed' survives into the
-- new five-value enum, so the policy body needs no adjustment.
create policy reviews_insert on public.reviews
  for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.buyer_id = auth.uid()
        and o.status = 'completed'
    )
  );


-- ---- 8. Table privileges (R-9, R-10) -------------------------------------
-- Recreated tables inherit nothing: this project's default privileges grant only
-- maintenance rights (TRUNCATE/REFERENCES/TRIGGER), and the setup-phase blanket
-- grant ran once, in 20260710015112, against the tables as they existed then.
-- Every privilege below is therefore deliberate.
--
-- orders: SELECT to authenticated ONLY. A direct client INSERT/UPDATE/DELETE
-- fails with a hard permission error (42501) rather than an RLS zero-row no-op —
-- the write model is hard failure, not silent filtering (R-9). anon gets nothing.
grant select on public.orders to authenticated;
grant select, insert, update, delete on public.orders to service_role;

-- payments: nothing to anon or authenticated. UPDATE withheld even from
-- service_role — see the table comment (R-10).
grant select, insert, delete on public.payments to service_role;


-- ---- 9. State-machine functions ------------------------------------------
-- All SECURITY DEFINER: they run as owner, so they reach the tables without any
-- client-role privilege and without RLS. Each re-derives the caller from
-- auth.uid() and enforces its own from-status — never trusting the client.

-- Create the hold. Validates the listing is buyable and the caller isn't the
-- seller, converts the price to cents, and leans on the partial unique index to
-- reject a second pending order.
create or replace function public.create_pending_order(
  p_listing_id uuid,
  p_reference  text
)
returns public.orders
language plpgsql
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

-- Payment success, atomically (D6): mark paid, write the split, sell the
-- listing. Idempotent by reference (D10) so the webhook and the callback can
-- both run it — whichever is second is a no-op.
create or replace function public.finalize_order_payment(
  p_reference       text,
  p_verified_amount bigint
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order          public.orders;
  v_commission     bigint;
  v_listing_status public.listing_status;
begin
  select * into v_order
    from public.orders
   where paystack_reference = p_reference
     for update;

  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  -- Already finalised — return unchanged, no error (D10).
  if v_order.status in ('paid', 'completed') then
    return v_order;
  end if;

  if v_order.status <> 'pending_payment' then
    raise exception 'order_not_pending' using errcode = 'P0001';
  end if;
  if p_verified_amount <> v_order.amount_total then
    raise exception 'amount_mismatch' using errcode = 'P0001';
  end if;

  -- D7 — flat 5% platform commission, rounded half up on cents.
  -- ⚠ This literal is the AUTHORITATIVE rate (D6 requires the split to be
  -- computed inside this transaction). PLATFORM_COMMISSION_RATE in the app must
  -- stay in sync with it; the app's copy is for display/estimates only.
  -- round() on numeric rounds half away from zero, i.e. half up for positives.
  v_commission := round(v_order.amount_total * 0.05)::bigint;

  update public.orders
     set status            = 'paid',
         paid_at           = now(),
         commission_amount = v_commission,
         seller_net        = v_order.amount_total - v_commission
   where id = v_order.id
  returning * into v_order;

  -- Sell the listing in the same transaction. active→sold and paused→sold are
  -- both legal. A deleted/removed listing is left alone: the order still counts
  -- as paid — the buyer's money is real either way.
  select status into v_listing_status
    from public.listings
   where id = v_order.listing_id
     for update;

  if v_listing_status in ('active', 'paused') then
    update public.listings set status = 'sold' where id = v_order.listing_id;
  else
    raise notice
      'finalize_order_payment: listing % is %, left untouched; order % is still paid',
      v_order.listing_id, v_listing_status, v_order.id;
  end if;

  return v_order;
end;
$$;

-- Buyer releases their own hold. Only from pending_payment.
create or replace function public.cancel_pending_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  update public.orders
     set status = 'cancelled', cancelled_at = now()
   where id = p_order_id
     and buyer_id = auth.uid()
     and status = 'pending_payment'
  returning * into v_order;

  if not found then
    raise exception 'order_not_cancellable' using errcode = 'P0001';
  end if;
  return v_order;
end;
$$;

-- Inngest expiry, 30 minutes after creation. Races payment by design; payment
-- wins, and losing the race is a SUCCESS (false = nothing to do), not an error.
create or replace function public.expire_pending_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_affected int;
begin
  update public.orders
     set status = 'expired', expired_at = now()
   where id = p_order_id
     and status = 'pending_payment';
  get diagnostics v_affected = row_count;
  return v_affected > 0;
end;
$$;

-- Buyer confirms receipt. paid → completed; the payouts phase treats this as
-- the payout-eligibility trigger.
create or replace function public.complete_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  update public.orders
     set status = 'completed', completed_at = now()
   where id = p_order_id
     and buyer_id = auth.uid()
     and status = 'paid'
  returning * into v_order;

  if not found then
    raise exception 'order_not_completable' using errcode = 'P0001';
  end if;
  return v_order;
end;
$$;

-- Persist Paystack's hosted authorization_url after initialize, so the buyer can
-- resume payment. Server-side only — this exists precisely so the client role
-- needs no UPDATE privilege on orders.
create or replace function public.set_order_authorization_url(
  p_order_id uuid,
  p_url      text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_affected int;
begin
  update public.orders
     set paystack_authorization_url = p_url
   where id = p_order_id
     and status = 'pending_payment';
  get diagnostics v_affected = row_count;
  return v_affected > 0;
end;
$$;


-- ---- 10. Function privileges (R-10) --------------------------------------
-- Written explicitly rather than relying on inherited defaults. Revoke first so
-- the grants below are the complete, auditable picture.
revoke execute on function public.create_pending_order(uuid, text)          from public, anon, authenticated;
revoke execute on function public.cancel_pending_order(uuid)                from public, anon, authenticated;
revoke execute on function public.complete_order(uuid)                      from public, anon, authenticated;
revoke execute on function public.finalize_order_payment(text, bigint)      from public, anon, authenticated;
revoke execute on function public.expire_pending_order(uuid)                from public, anon, authenticated;
revoke execute on function public.set_order_authorization_url(uuid, text)   from public, anon, authenticated;

-- Buyer-invoked, from the browser session.
grant execute on function public.create_pending_order(uuid, text) to authenticated;
grant execute on function public.cancel_pending_order(uuid)       to authenticated;
grant execute on function public.complete_order(uuid)             to authenticated;

-- Server-only. finalize_order_payment in particular must never be callable by a
-- client: it is the function that decides money moved.
grant execute on function public.finalize_order_payment(text, bigint)    to service_role;
grant execute on function public.expire_pending_order(uuid)              to service_role;
grant execute on function public.set_order_authorization_url(uuid, text) to service_role;


-- ---- 11. Listing quantity is out of scope (R-3) --------------------------
comment on column public.listings.quantity is
  'NOT used by checkout (R-3): checkout treats every listing as a unique single '
  'item (D1) — it neither checks nor decrements this. Retained for a possible '
  'future multi-quantity model.';
