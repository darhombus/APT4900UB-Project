-- ============================================================================
-- PAYOUTS SCHEMA — payout_recipients and the payouts rebuild
-- (Payouts PRD — Section 3; rulings P1, P3, P7, P10, PR-1, PR-6, PR-8, PR-9)
--
-- `payouts` is NOT a new table. A legacy version has existed since the
-- ERD-derived initial migration (20260710013856_initial_schema.sql:171) in a
-- shape that predates the platform-checkout money model entirely:
--
--   amount numeric(12,2), currency text, order_id uuid, provider_ref text,
--   status public.payout_status  -- ('pending','processing','paid','failed')
--
-- Note the enum: 'paid' rather than 'success', and no 'reversed' at all. The
-- payouts phase needs five states including 'reversed', and Postgres cannot
-- remove an enum value, so reaching the intended set would require recreating
-- the type regardless.
--
-- Ruling PR-1: the table is empty on every tier (verified local: 0 rows) and no
-- application code has ever written it, so it is DROPPED and RECREATED rather
-- than ALTERed — the same reasoning, and the same precedent, as checkout ruling
-- R-1 (see the header of 20260727170000_checkout_schema.sql). The initial
-- migration is NOT edited; this migration is the correction.
--
-- Ruling PR-8 — the legacy table is not merely stale, it is a live privilege
-- hole. Verified on the local stack before this migration:
--
--   payouts | anon          | REFERENCES, SELECT, TRIGGER, TRUNCATE
--   payouts | authenticated | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   payouts | service_role  | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--
-- Those came from the blanket grant at 20260710015112_rls_policies.sql:58-60,
-- from which only `payments` was ever revoked (line 65). RLS has been the sole
-- line of defence on this table ever since — the same class of regression the
-- checkout hardening migration fixed for orders/payments, on the one money
-- table that migration did not cover. The grants at the foot of this file are
-- therefore mandatory and load-bearing, not precautionary.
-- ============================================================================


-- ---- 0. Tear down the legacy payouts objects (PR-1, PR-9) -----------------
-- `drop table` takes the following with it. They are named here so the teardown
-- is auditable rather than implicit (PR-9):
--   * trigger    payouts_updated_at        (set_updated_at, from the initial migration)
--   * index      payouts_pkey              (primary key)
--   * index      payouts_provider_ref_key  (from `provider_ref text unique`)
--   * index      payouts_seller_idx
--   * policy     payouts_select
--   * constraint payouts_order_id_fkey     (dropped and restored by the checkout
--                                           migration; it goes for good here)
--   * the inherited anon/authenticated grants quoted in the header
drop table if exists public.payouts;

-- Dropping the table does NOT drop the enum, so it goes separately. Nothing
-- else references it — the only column that ever did was payouts.status, which
-- has just gone. The new status column is text + check (step 2), so the enum is
-- deliberately NOT recreated: a check constraint can gain a value in a later
-- migration, which is precisely what an enum could not do here.
drop type if exists public.payout_status;


-- ---- 1. PAYOUT_RECIPIENTS — one Mpesa destination per seller (P1) ---------
create table public.payout_recipients (
  id                      uuid primary key default gen_random_uuid(),
  seller_id               uuid not null references public.profiles (id) on delete restrict,
  paystack_recipient_code text not null,
  phone_masked            text not null,
  created_at              timestamptz not null default now()
);

comment on table public.payout_recipients is
  'Paystack transfer recipients for seller payouts (P1). One row per seller. '
  'Writes are service-role only; sellers read their own row through the '
  'authenticated SELECT grant scoped by the RLS policy below (PR-8).';
comment on column public.payout_recipients.paystack_recipient_code is
  'Paystack''s recipient_code. The phone number itself is never stored in full — '
  'only the masked form beside it.';
comment on column public.payout_recipients.phone_masked is
  'Display-only, e.g. 2547****321. Registration masks before storing; the raw '
  'MSISDN goes to Paystack and is not retained.';

-- One active recipient per seller. Replacement is delete+insert via the service
-- role, so this unique index is the guarantee rather than application logic.
create unique index payout_recipients_seller_key
  on public.payout_recipients (seller_id);


-- ---- 2. PAYOUTS — the rebuilt payout ledger -------------------------------
-- Money is bigint KES cents throughout (D8), matching orders.amount_total and
-- orders.seller_net. The legacy numeric(12,2) shape is gone with the old table.
create table public.payouts (
  id                          uuid primary key default gen_random_uuid(),
  seller_id                   uuid not null references public.profiles (id) on delete restrict,
  amount_kes_cents            bigint not null check (amount_kes_cents > 0),
  fee_kes_cents               bigint not null default 0 check (fee_kes_cents >= 0),
  transfer_amount_kes_cents   bigint generated always as (amount_kes_cents - fee_kes_cents) stored,
  recipient_code              text not null,
  paystack_transfer_reference text not null,
  origin                      text not null check (origin in ('instant', 'weekly')),
  status                      text not null default 'pending'
                                check (status in ('pending', 'processing', 'success', 'failed', 'reversed')),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint payouts_fee_within_amount check (fee_kes_cents <= amount_kes_cents)
);

comment on table public.payouts is
  'Seller payout ledger. Immutable beyond status, enforced by PRIVILEGE rather '
  'than by trigger (R-10 pattern): NO role holds UPDATE, including service_role, '
  'so the only write path to `status` is the security-definer '
  'transition_payout_status. service_role holds SELECT/INSERT/DELETE; DELETE '
  'exists solely so the e2e teardown helper can clear test rows ahead of the '
  'ON DELETE RESTRICT FK to profiles (R-5).';
comment on column public.payouts.amount_kes_cents is
  'GROSS amount deducted from the seller''s derived balance (P2). Not what lands '
  'in their phone — see transfer_amount_kes_cents.';
comment on column public.payouts.fee_kes_cents is
  'The 1% instant-withdrawal fee, floored (P11, A3). Always 0 for origin=weekly, '
  'which is free. Computed by computeInstantPayoutFee in payout-constants.ts.';
comment on column public.payouts.transfer_amount_kes_cents is
  'What Paystack actually transfers. Generated, so gross/fee/net can never drift '
  'apart through an application bug.';
comment on column public.payouts.recipient_code is
  'Snapshot of payout_recipients.paystack_recipient_code at creation time (P3). '
  'Snapshotted so a later change of destination cannot rewrite where an '
  'already-initiated transfer was sent.';
comment on column public.payouts.paystack_transfer_reference is
  'Equals id::text (P7). Populated explicitly at insert rather than by default, '
  'since a column default cannot reference another column of the same row. This '
  'is the idempotency key: retrying a transfer with the same reference is safe.';
comment on column public.payouts.updated_at is
  'Maintained by transition_payout_status, NOT by a trigger. The legacy table had '
  'a set_updated_at trigger; it is deliberately not recreated, because no role '
  'holds UPDATE and the sole writer sets this column itself.';

-- P7 — the reference is the idempotency key, so it must be unique.
create unique index payouts_transfer_reference_key
  on public.payouts (paystack_transfer_reference);

-- P10 — at most one in-flight payout per seller. The Section 6 action's check
-- and the Section 9 sweep's query are both UX/efficiency; THIS is the guarantee.
-- Partial, so completed/failed/reversed rows never block a later withdrawal.
create unique index payouts_one_in_flight_per_seller
  on public.payouts (seller_id)
  where status in ('pending', 'processing');

create index payouts_seller_idx on public.payouts (seller_id, created_at desc);


-- ---- 3. RLS --------------------------------------------------------------
-- Both tables: sellers read their own rows and nothing else. These policies are
-- reachable and load-bearing precisely because `authenticated` holds SELECT
-- below (PR-8) — GRANT and RLS are independent gates and the GRANT is checked
-- first, so withholding SELECT would have made these decoration.
--
-- The legacy payouts_select policy died with the legacy table in step 0; this
-- is a fresh policy, not a survivor.
alter table public.payout_recipients enable row level security;
alter table public.payouts           enable row level security;

create policy payout_recipients_select on public.payout_recipients
  for select using (
    seller_id = auth.uid() or public.is_admin()
  );

create policy payouts_select on public.payouts
  for select using (
    seller_id = auth.uid() or public.is_admin()
  );

-- No INSERT/UPDATE/DELETE policies on either table, deliberately. Writes are
-- service-role only, and service_role bypasses RLS — for it, the GRANTs at the
-- foot of this file are the ONLY control.


-- ---- 4. Grants (PR-6, PR-8) ----------------------------------------------
-- REVOKE first, then GRANT exactly what is intended. Granting alone is silently
-- correct locally and silently wrong on hosted, where default privileges hand a
-- new table full DML to every role — and the legacy payouts table above is this
-- project's proof that the failure mode is real, not theoretical.
revoke all on public.payout_recipients from anon, authenticated, service_role;
revoke all on public.payouts           from anon, authenticated, service_role;

-- Sellers read their own rows: the authenticated SELECT grant, row-scoped by the
-- policies above. Follows the ORDERS precedent (R-9), not the PAYMENTS precedent
-- (R-10), because payout history is a seller-facing UI surface (P3).
-- No INSERT/UPDATE/DELETE to any client role: a direct client write fails 42501
-- rather than being silently filtered to zero rows.
grant select on public.payout_recipients to authenticated;
grant select on public.payouts           to authenticated;

-- anon gets nothing at all, on either table. An anonymous read is a hard
-- permission error, not an empty result.

-- service_role: SELECT/INSERT/DELETE but deliberately NOT UPDATE. That absence
-- is what makes the payout trail immutable in a way no application bug or
-- compromised server key can undo — transitions go through
-- transition_payout_status (Section 4), which runs as the owner.
grant select, insert, delete on public.payout_recipients to service_role;
grant select, insert, delete on public.payouts           to service_role;
