-- ============================================================================
-- ADM-15 — A REFUNDED ORDER IS PERMANENTLY EXCLUDED FROM SELLER EARNINGS
--
-- ADM-11 excluded a disputed order's seller_net while the dispute was live
-- ('open','under_review'). On resolution the dispute left those states and the
-- money returned to the seller — INCLUDING when the outcome was a refund and
-- the buyer had already been made whole. `order_status` has no refunded value
-- and `admin_resolve_dispute` never touches `orders`, so nothing deducted it.
-- The platform paid the buyer back and credited the seller the same money.
--
-- That behaviour was specified, implemented, and PINNED BY A TEST asserting it
-- as correct (adm11-dispute-payout-hold.test.ts). The specification was wrong.
-- That test is re-ruled in the same unit as this migration; it now asserts the
-- seller sees zero returned, and it FAILED against the old predicate before
-- this migration was written — which is what makes it evidence rather than
-- decoration.
--
-- 'resolved_rejected' CONTINUES TO RELEASE, and that asymmetry is the whole
-- ruling: no money moved, so the hold lifts. A predicate keyed on "the dispute
-- reached a terminal state" would release both and is exactly what this is not.
--
-- ORDER-GRANULAR, RECORDED AS A LIMITATION. Exclusion is per order, so a
-- PARTIAL refund is not representable — a half-refunded order is withheld in
-- full. Acceptable while ADM-3 refunds are whole-order and manual; documented
-- as future work alongside the Paystack refund API.
-- ============================================================================


-- ---- THE RULE, DEFINED ONCE --------------------------------------------------
-- Both balance functions previously carried their own copy of the dispute
-- predicate. Two copies of a money rule is how they drift; this makes it one.
-- The TypeScript display readers carry the matching status list in
-- $lib/disputes.ts (EARNINGS_BLOCKING_DISPUTE_STATUSES), and a db test asserts
-- that list agrees with THIS function for all four dispute states, so the two
-- language-side definitions cannot diverge silently either.
--
-- SECURITY INVOKER (the default — deliberately no `security definer`). The
-- callers are SECURITY INVOKER too, so the disputes read stays under the
-- CALLER's RLS exactly as ADM-11 documented. The failure direction is unchanged
-- and still FAIL-OPEN: a caller who cannot see the dispute row reads the order
-- as earnable. That is why disputes_select admits both parties and admins.
create or replace function public.order_earnings_blocked(p_order_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.disputes d
     where d.order_id = p_order_id
       -- 'open','under_review'  — held while the claim is live (ADM-11)
       -- 'resolved_refunded'    — held permanently; the buyer has the money
       --                          back and nothing else deducts it (ADM-15)
       -- 'resolved_rejected'    — DELIBERATELY ABSENT. No money moved, so the
       --                          hold lifts and the seller is paid.
       and d.status in ('open', 'under_review', 'resolved_refunded')
  );
$$;

comment on function public.order_earnings_blocked(uuid) is
  'ADM-15. True when an order''s seller_net must not count toward seller '
  'earnings: a live dispute (open/under_review) or a refund '
  '(resolved_refunded, permanent). resolved_rejected returns false — no money '
  'moved. The single definition of this rule; both balance functions call it '
  'and the TypeScript readers mirror it via EARNINGS_BLOCKING_DISPUTE_STATUSES '
  'with a test asserting the two agree.';

-- Revoke-then-grant (the standing pattern — default privileges are not a clean
-- slate, and hosted carries template grants a local reset never reproduces).
-- Called only from inside the two SECURITY INVOKER balance functions, so the
-- roles that need it are exactly the roles that call those.
revoke all on function public.order_earnings_blocked(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.order_earnings_blocked(uuid) to authenticated, service_role;


-- ---- seller_available_balance ------------------------------------------------
-- BEFORE (the dispute predicate only):
--     and not exists (
--       select 1
--         from public.disputes d
--        where d.order_id = o.id
--          and d.status in ('open', 'under_review')
--     )
-- AFTER:
--     and not public.order_earnings_blocked(o.id)
--
-- EVERY OTHER PREDICATE IS PRESERVED VERBATIM: the seller_id filter, the
-- `status = 'completed'` filter, the `completed_at <= now() - interval '2 days'`
-- hold window, the payouts deduction set, and the greatest(..., 0) floor with
-- its ADM-11 monotonicity note.
create or replace function public.seller_available_balance(p_seller_id uuid)
returns bigint
language sql
stable
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
       -- ADM-11 + ADM-15 — the dispute hold, now one shared definition.
       -- Order-scoped: one blocked order withholds its own seller_net and
       -- nothing else, so a seller with a dispute on one order can still
       -- withdraw everything they earned on the others. Evaluated under the
       -- CALLER's RLS on disputes — the FAIL-OPEN direction is unchanged.
       and not public.order_earnings_blocked(o.id)
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
  -- greatest(..., 0) — REWRITTEN FOR ADM-11, and MORE reachable after ADM-15.
  -- Its original justification was that earnings are monotonic ("an order never
  -- leaves 'completed', and order_status has no refund state").
  --
  -- THAT IS NO LONGER TRUE, and ADM-15 widens the gap. Earnings are
  -- non-monotonic: a dispute opened AFTER a payout has been released removes
  -- that order's seller_net from earnings while the payout itself remains in
  -- deductions, and under ADM-15 a refund makes that removal PERMANENT rather
  -- than temporary. The intermediate goes negative and this floor absorbs it —
  -- a SOFT CLAWBACK against the seller's future earnings, which is now the
  -- standing outcome for a post-payout refund rather than a transient one.
  --
  -- The behaviour is deliberately UNCHANGED here. ADM-11 recorded the
  -- post-payout case as accepted residual exposure, recoverable only manually;
  -- ADM-15 does not change that, it only makes the floor the permanent
  -- settlement rather than a temporary dip. Whether a soft clawback is the
  -- right remedy remains a separate ruling.
  select greatest((select total from earnings) - (select total from deductions), 0);
$$;


-- ---- seller_pending_balance --------------------------------------------------
-- BEFORE: the same two-state `not exists` block quoted above.
-- AFTER:  and not public.order_earnings_blocked(o.id)
--
-- Every other predicate preserved verbatim, including the complement hold
-- window `completed_at > now() - interval '2 days'`.
create or replace function public.seller_pending_balance(p_seller_id uuid)
returns bigint
language sql
stable
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
     -- ADM-11 + ADM-15. This figure moves no money; it is the "releasing soon"
     -- number on the seller's payouts page. Excluding blocked orders here is
     -- what stops the UI promising a release date for money that is on hold, or
     -- for money the buyer has already been refunded.
     and not public.order_earnings_blocked(o.id);
$$;


-- ---- SECURITY INVOKER MUST SURVIVE -------------------------------------------
-- `create or replace function` without `security definer` yields prosecdef =
-- false, but this is a money path and the property is asserted rather than
-- assumed: a SECURITY DEFINER balance function would read disputes as the
-- OWNER, silently bypassing the RLS the display path depends on.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('seller_available_balance', 'seller_pending_balance',
                         'order_earnings_blocked')
       and p.prosecdef
  ) then
    raise exception 'ADM-15: a balance function is SECURITY DEFINER; it must be INVOKER';
  end if;
end $$;
