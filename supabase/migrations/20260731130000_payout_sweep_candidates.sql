-- ============================================================================
-- WEEKLY SWEEP ELIGIBILITY
-- (Payouts PRD — Section 9; decisions P5, P6, P10; ruling PR-10)
--
-- The sweep's eligibility rule lives in SQL rather than in the Inngest function
-- because all three conditions are relational, and expressing them as one query
-- is both cheaper and harder to get subtly wrong than three round trips plus a
-- filter in TypeScript.
--
-- The MINIMUM is a PARAMETER, not a hard-coded literal. Unlike the 2-day hold —
-- which is embedded in seller_available_balance because the UI calls that
-- function too — this threshold has exactly one caller, so MIN_PAYOUT_KES_CENTS
-- in src/lib/server/payout-constants.ts can stay the single source of truth and
-- no second copy of the number exists to drift.
-- ============================================================================

create or replace function public.payout_sweep_candidates(p_min_kes_cents bigint)
returns table (
  seller_id        uuid,
  recipient_code   text,
  amount_kes_cents bigint
)
language sql
stable
security definer
set search_path = public
as $$
  -- Starting FROM payout_recipients is what implements "has a recipient" (P1):
  -- a seller with no row here is not a candidate and is never considered. That
  -- is the silent skip P6 asks for — no branch, no log, simply not selected.
  select r.seller_id,
         r.paystack_recipient_code,
         b.amount
    from public.payout_recipients r
    -- LATERAL so the balance is computed once per seller rather than twice
    -- (once for the filter, once for the projection).
    cross join lateral (
      select public.seller_available_balance(r.seller_id) as amount
    ) b
   where
     -- P6 — sub-threshold balances are skipped and roll forward to next week.
     b.amount >= p_min_kes_cents
     -- P10 — a seller with a payout already in flight is excluded. This mirrors
     -- the partial unique index, but does NOT replace it: this query is an
     -- optimisation that avoids doomed inserts, while the index is the guard
     -- that a concurrent request cannot slip past.
     and not exists (
       select 1
         from public.payouts p
        where p.seller_id = r.seller_id
          and p.status in ('pending', 'processing')
     );
$$;

comment on function public.payout_sweep_candidates(bigint) is
  'Sellers eligible for the weekly sweep (Section 9): has a recipient, available '
  'balance at or above the given minimum, and no in-flight payout. SECURITY '
  'DEFINER because the sweep is inherently cross-seller — seller_available_balance '
  'is SECURITY INVOKER and would be RLS-filtered to nothing for any other caller.';


-- ---- Grants (PR-10) -------------------------------------------------------
-- REVOKE first, then GRANT: Postgres grants EXECUTE to PUBLIC by default.
revoke execute on function public.payout_sweep_candidates(bigint) from public, anon, authenticated;

-- service_role ONLY. This function deliberately reads across every seller, so
-- exposing it to a client role would leak the whole platform's balance sheet.
grant execute on function public.payout_sweep_candidates(bigint) to service_role;
