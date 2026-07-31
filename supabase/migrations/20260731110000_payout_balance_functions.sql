-- ============================================================================
-- PAYOUT BALANCE DERIVATION AND STATUS TRANSITIONS
-- (Payouts PRD — Section 4; decisions P2, P3, P4, P9; rulings PR-4, PR-10)
--
-- P2 — the balance is DERIVED, never stored. There is no balance column
-- anywhere, and there deliberately never will be: a stored balance is a second
-- source of truth that drifts the first time a transfer half-fails.
--
-- PR-4 — payout eligibility is status = 'completed' with timestamp
-- completed_at. NOT paid/paid_at. `finalize_order_payment` sets paid/paid_at
-- despite being named "finalize"; the trigger for payout purposes is the buyer
-- confirming receipt (complete_order) or the Section 4A auto-completion. An
-- order sitting at 'paid' contributes to NEITHER balance — it is not yet earned.
-- ============================================================================


-- ---- 1. Available balance (P2, P4) ---------------------------------------
-- SECURITY INVOKER, deliberately. RLS already expresses exactly the right scope:
--   * orders_select  — a seller reads rows where seller_id = auth.uid()
--   * payouts_select — a seller reads their own payout rows
-- so an authenticated caller can only ever compute their OWN balance, and the
-- Section 9 sweep runs as service_role, which bypasses RLS and therefore sees
-- every seller. One function, correct for both callers, with no explicit seller
-- check to keep in sync with the policies.
--
-- A cross-seller call from a session client is not an error and not a leak: RLS
-- filters the rows away and the function returns 0.
create or replace function public.seller_available_balance(p_seller_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  with earnings as (
    -- seller_net is written once by finalize_order_payment and never recomputed
    -- (D7). Nothing here re-derives the commission split.
    --
    -- interval '2 days' mirrors PAYOUT_HOLD_DAYS in
    -- src/lib/server/payout-constants.ts. There is no single-source-of-truth
    -- mechanism for a constant shared between SQL and TypeScript on this
    -- project; the constants module's unit test pins the value from the other
    -- side so a one-sided edit fails loudly rather than silently.
    select coalesce(sum(o.seller_net), 0)::bigint as total
      from public.orders o
     where o.seller_id = p_seller_id
       and o.status = 'completed'
       and o.completed_at <= now() - interval '2 days'
  ),
  deductions as (
    -- P9 — 'failed' and 'reversed' are deliberately absent, which is what makes
    -- a failed transfer restore the balance automatically with no compensating
    -- write anywhere.
    select coalesce(sum(p.amount_kes_cents), 0)::bigint as total
      from public.payouts p
     where p.seller_id = p_seller_id
       and p.status in ('pending', 'processing', 'success')
  )
  -- greatest(..., 0) is a floor against a bug, not an expected path: earnings
  -- are monotonic (an order never leaves 'completed', and order_status has no
  -- refund state), and a payout can only ever be created for a balance that
  -- already existed. A negative intermediate would mean a payout was written
  -- against earnings that are not there — worth catching, never worth exposing.
  select greatest((select total from earnings) - (select total from deductions), 0);
$$;

comment on function public.seller_available_balance(uuid) is
  'Withdrawable balance in KES cents (P2). Completed orders past the 2-day hold, '
  'minus payouts in pending/processing/success. Derived on every read — there is '
  'no stored balance. SECURITY INVOKER: RLS scopes a session client to its own '
  'rows; service_role bypasses RLS for the weekly sweep.';


-- ---- 2. Pending (held) balance — UI display only (P4) --------------------
create or replace function public.seller_pending_balance(p_seller_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  -- Same earnings computation as above, but the complement of the hold window:
  -- completed, and completed RECENTLY. No payout deductions, because these funds
  -- cannot have been paid out yet — they were never available to withdraw.
  select coalesce(sum(o.seller_net), 0)::bigint
    from public.orders o
   where o.seller_id = p_seller_id
     and o.status = 'completed'
     and o.completed_at > now() - interval '2 days';
$$;

comment on function public.seller_pending_balance(uuid) is
  'Held funds in KES cents: completed orders still inside the 2-day window (P4). '
  'Display only — Section 10 renders it with a release date. Orders at status '
  '''paid'' appear in neither this nor seller_available_balance (PR-4).';


-- ---- 3. The only write path to payouts.status (P3) -----------------------
-- SECURITY DEFINER because NO role holds UPDATE on public.payouts — not even
-- service_role (R-10 pattern). That absence is the immutability guarantee, and
-- this function, owned by postgres, is the single deliberate exception to it.
--
-- Mirrors the checkout finalization pattern: the transition graph lives in the
-- database, so an out-of-order webhook or a duplicate delivery is rejected by
-- the data layer rather than by whichever caller happened to arrive first.
create or replace function public.transition_payout_status(
  p_payout_id  uuid,
  p_new_status text
)
returns public.payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payout public.payouts;
  v_from   text;
begin
  select * into v_payout
    from public.payouts
   where id = p_payout_id
     for update;

  if not found then
    raise exception 'payout_not_found' using errcode = 'P0002';
  end if;

  v_from := v_payout.status;

  -- The complete transition graph (P8, P9). Anything not listed raises, which
  -- Sections 7 and 8 rely on: they catch the exception and return 200 rather
  -- than letting a replayed webhook drive a second transition.
  --   pending    → processing   (transfer initiated)
  --   processing → success      (verified success)
  --   processing → failed       (verified failure)
  --   success    → reversed     (verified reversal, after the fact)
  if not (
       (v_from = 'pending'    and p_new_status = 'processing')
    or (v_from = 'processing' and p_new_status = 'success')
    or (v_from = 'processing' and p_new_status = 'failed')
    or (v_from = 'success'    and p_new_status = 'reversed')
  ) then
    raise exception 'invalid_payout_transition: % -> %', v_from, p_new_status
      using errcode = 'P0001';
  end if;

  update public.payouts
     set status     = p_new_status,
         updated_at = now()
   where id = p_payout_id
  returning * into v_payout;

  return v_payout;
end;
$$;

comment on function public.transition_payout_status(uuid, text) is
  'The ONLY write path to payouts.status (P3). Enforces the transition graph '
  'pending→processing→success|failed and success→reversed; anything else raises '
  'P0001. SECURITY DEFINER because no role — including service_role — holds '
  'UPDATE on payouts.';


-- ---- 4. Function grants (PR-10) ------------------------------------------
-- REVOKE first, then GRANT. Postgres grants EXECUTE to PUBLIC by default, so
-- granting alone would leave that default in place — the same silently-wrong
-- shape the table grants avoid. Follows 20260727170000_checkout_schema.sql:437-453.
revoke execute on function public.seller_available_balance(uuid)      from public, anon, authenticated;
revoke execute on function public.seller_pending_balance(uuid)        from public, anon, authenticated;
revoke execute on function public.transition_payout_status(uuid, text) from public, anon, authenticated;

-- The balance functions are seller-facing: the payouts page calls them through
-- the SESSION client under RLS (PR-8 consequence), so `authenticated` needs
-- EXECUTE. service_role needs them too, for the weekly sweep's eligibility query.
grant execute on function public.seller_available_balance(uuid) to authenticated, service_role;
grant execute on function public.seller_pending_balance(uuid)   to authenticated, service_role;

-- The transition function is service-role ONLY. A seller must never be able to
-- mark their own payout successful.
grant execute on function public.transition_payout_status(uuid, text) to service_role;
