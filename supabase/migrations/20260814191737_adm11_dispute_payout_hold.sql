-- ============================================================================
-- ADM SECTION 4C — THE DISPUTE PAYOUT HOLD (ADM-11)
--
-- An order carrying a dispute in 'open' or 'under_review' stops contributing to
-- its seller's balance until that dispute resolves.
--
-- ---------------------------------------------------------------------------
-- WHY HERE AND NOWHERE ELSE
--
-- The obvious site looks like payout_sweep_candidates, and it is the wrong one.
-- That function is SELLER-scoped: it returns (seller_id, recipient_code,
-- amount) and has no `orders` alias at all, so `d.order_id = o.id` cannot
-- compile there. Worse, if it were forced to work it would exclude the whole
-- SELLER from the sweep over a single disputed order, freezing money that is
-- not in dispute.
--
-- seller_available_balance is ORDER-scoped and is the shared choke point: the
-- weekly sweep reaches it through payout_sweep_candidates' lateral join, and
-- the instant withdrawal reaches it directly from the withdrawNow action. One
-- re-created function covers both money-moving paths, which is why
-- payout_sweep_candidates is deliberately left untouched by this migration.
--
-- seller_pending_balance gets the same predicate. It moves no money — it is the
-- "releasing soon" figure on the seller's payouts page — but leaving it alone
-- would have the UI promise a release date for money that is on hold.
--
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER IS PRESERVED, DELIBERATELY
--
-- Both functions stay SECURITY INVOKER. Switching either to DEFINER to "make
-- the subquery reliable" would silently widen EVERY other predicate in them —
-- a session client would begin computing balances across sellers rather than
-- being RLS-filtered to its own rows, and the existing design note at
-- 20260731110000:33-40 depends on exactly that filtering.
--
-- THE CONSEQUENCE, STATED PLAINLY: the added `not exists (... disputes ...)`
-- subquery is evaluated under the CALLER's RLS on public.disputes, and its
-- failure direction is FAIL-OPEN. A caller who cannot see a dispute row gets
-- `not exists` = true and a balance that reads as available.
--
-- That is safe for the money paths and load-bearing for the display path:
--   * the weekly sweep runs as service_role, which holds BYPASSRLS — it sees
--     every dispute, so the hold always applies where money actually moves;
--   * withdrawNow also runs as service_role, via createSupabaseAdmin();
--   * the seller's own payouts page calls this through a SESSION client, so its
--     correctness depends on disputes_select admitting the seller. It does
--     today, through dispute_party(order_id) — verified live. If that policy is
--     ever narrowed, this display over-reports rather than under-reports, and
--     the seller sees money they cannot withdraw.
-- ============================================================================


-- ---- seller_available_balance ---------------------------------------------
-- BEFORE (live, captured for the diff):
--   earnings:   o.seller_id = p_seller_id
--               o.status = 'completed'
--               o.completed_at <= now() - interval '2 days'
--   deductions: p.seller_id = p_seller_id
--               p.status in ('pending', 'processing', 'success')
--   result:     greatest(earnings - deductions, 0)
--
-- AFTER: every predicate above is preserved verbatim; one `not exists` is added
-- to the earnings CTE and nothing else changes.
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
       -- ADM-11 — the dispute hold. Order-scoped: one disputed order withholds
       -- its own seller_net and nothing else, so a seller with a dispute on one
       -- order can still withdraw everything they earned on the others.
       -- Evaluated under the caller's RLS on disputes — see the FAIL-OPEN note
       -- in this migration's header.
       and not exists (
         select 1
           from public.disputes d
          where d.order_id = o.id
            and d.status in ('open', 'under_review')
       )
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
  -- greatest(..., 0) — REWRITTEN FOR ADM-11. Its original justification was
  -- that earnings are monotonic ("an order never leaves 'completed', and
  -- order_status has no refund state"), which made a negative intermediate a
  -- floor against a bug rather than an expected path.
  --
  -- THAT IS NO LONGER TRUE. Earnings are now non-monotonic: a dispute opened
  -- AFTER a payout has been released removes that order's seller_net from
  -- earnings while the payout itself remains in deductions. The intermediate
  -- goes negative and this floor silently absorbs it — the seller's next
  -- earnings are consumed until the arithmetic recovers. That is a SOFT
  -- CLAWBACK, and it is undocumented nowhere else, which is the only reason it
  -- is written out here.
  --
  -- The behaviour is deliberately UNCHANGED in this phase. Whether a soft
  -- clawback is the right remedy for a post-payout dispute is a separate
  -- ruling; ADM-11 records the post-payout case as accepted residual exposure,
  -- recoverable only manually. What is fixed here is that the floor is no
  -- longer described as unreachable when it is now reachable by design.
  select greatest((select total from earnings) - (select total from deductions), 0);
$$;

comment on function public.seller_available_balance(uuid) is
  'Withdrawable balance in KES cents (P2). Completed orders past the 2-day '
  'hold, excluding any order with a live dispute (ADM-11), minus payouts in '
  'pending/processing/success. Derived on every read — there is no stored '
  'balance. SECURITY INVOKER: RLS scopes a session client to its own rows; '
  'service_role bypasses RLS for the weekly sweep. The dispute subquery is '
  'therefore evaluated under the caller''s RLS and fails OPEN — safe for the '
  'service_role money paths, load-bearing for the seller''s display path.';


-- ---- seller_pending_balance -----------------------------------------------
-- BEFORE (live): o.seller_id = p_seller_id
--                o.status = 'completed'
--                o.completed_at > now() - interval '2 days'
--
-- AFTER: preserved verbatim, plus the same ADM-11 predicate.
create or replace function public.seller_pending_balance(p_seller_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  -- Same earnings computation as seller_available_balance, but the complement
  -- of the hold window: completed, and completed RECENTLY. No payout
  -- deductions, because these funds cannot have been paid out yet — they were
  -- never available to withdraw.
  select coalesce(sum(o.seller_net), 0)::bigint
    from public.orders o
   where o.seller_id = p_seller_id
     and o.status = 'completed'
     and o.completed_at > now() - interval '2 days'
     -- ADM-11. This figure moves no money; it is the "releasing soon" number on
     -- the seller's payouts page. Excluding disputed orders here is what stops
     -- the UI promising a release date for money that is on hold — the balance
     -- would otherwise silently drop when the order crossed the 2-day boundary
     -- into a held available balance.
     and not exists (
       select 1
         from public.disputes d
        where d.order_id = o.id
          and d.status in ('open', 'under_review')
     );
$$;

comment on function public.seller_pending_balance(uuid) is
  'Held funds in KES cents: completed orders still inside the 2-day window '
  '(P4), excluding any order with a live dispute (ADM-11). Display only. '
  'Orders at status ''paid'' appear in neither this nor '
  'seller_available_balance (PR-4).';


-- ---- Grants ---------------------------------------------------------------
-- `create or replace function` preserves the existing ACL, so these are a
-- re-assertion rather than a change. Stated explicitly anyway, per the standing
-- revoke-then-grant rule: never assume a clean slate, and never leave the
-- default PUBLIC execute standing.
--
-- Unchanged from 20260731110000: both are seller-facing (the payouts page calls
-- them through the session client under RLS) AND service_role-facing (the
-- weekly sweep's eligibility query).
revoke execute on function public.seller_available_balance(uuid) from public, anon;
revoke execute on function public.seller_pending_balance(uuid)   from public, anon;

grant execute on function public.seller_available_balance(uuid) to authenticated, service_role;
grant execute on function public.seller_pending_balance(uuid)   to authenticated, service_role;
