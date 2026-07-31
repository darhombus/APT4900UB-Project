-- ============================================================================
-- ORDER AUTO-COMPLETION — the backstop that stops an unresponsive buyer from
-- stranding a seller's money
-- (Payouts PRD — Section 4A; decision P4, rulings PR-4, PR-5, PR-7, PR-10)
--
-- PR-4 makes status='completed'/completed_at the sole payout-eligibility
-- trigger, and before this migration the ONLY path to 'completed' was
-- public.complete_order — the buyer pressing "confirm receipt". Verified in the
-- Section 1 survey:
--
--   complete_order | prosecdef = t | acl: postgres=X/postgres | authenticated=X/postgres
--
-- It is buyer-bound twice over: it raises 'not_authenticated' when auth.uid()
-- is null, and its UPDATE is filtered `and buyer_id = auth.uid()`. service_role
-- holds NO EXECUTE on it at all, so background code cannot call it even before
-- the auth.uid() check would fail.
--
-- A buyer who simply never confirms therefore left the seller unpaid forever —
-- the 2-day hold never even started. This companion function is the backstop.
-- complete_order itself is NOT modified; the buyer path is untouched.
-- ============================================================================

create or replace function public.auto_complete_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_affected int;
begin
  -- The age predicate lives HERE, not only in the Inngest sleep that schedules
  -- the call. The sleep is scheduling; this is the guarantee. Both must hold, so
  -- that a mis-scheduled, replayed or hand-invoked call still cannot complete an
  -- order early.
  --
  -- interval '7 days' mirrors AUTO_COMPLETE_DAYS in
  -- src/lib/server/payout-constants.ts, whose unit test pins the value from the
  -- other side so a one-sided edit fails loudly.
  update public.orders
     set status       = 'completed',
         completed_at = now()
   where id = p_order_id
     and status = 'paid'
     and paid_at <= now() - interval '7 days';

  get diagnostics v_affected = row_count;

  -- Affecting no row is a NORMAL outcome, not an exception — the buyer confirmed
  -- first, the order was cancelled, the window has not elapsed, or this is a
  -- duplicate delivery. Mirrors expire_pending_order's shape exactly: losing the
  -- race is a success, because there was simply nothing to do.
  return v_affected > 0;
end;
$$;

comment on function public.auto_complete_order(uuid) is
  'Backstop completion for a paid order the buyer never confirmed (Section 4A). '
  'Completes ONLY where status=''paid'' AND paid_at is older than 7 days '
  '(AUTO_COMPLETE_DAYS). Returns whether a row was affected; false is a normal '
  'no-op. service_role only — the buyer path (complete_order) is unchanged.';


-- ---- Grants (PR-10) -------------------------------------------------------
-- REVOKE first, then GRANT: Postgres grants EXECUTE to PUBLIC by default, so
-- granting alone would leave that default in place. Follows
-- 20260727170000_checkout_schema.sql:437-453.
revoke execute on function public.auto_complete_order(uuid) from public, anon, authenticated;

-- service_role ONLY. A buyer completing their own order goes through
-- complete_order, which is unchanged and still granted to authenticated; a
-- SELLER must never be able to complete an order on the buyer's behalf, which is
-- exactly what granting this to authenticated would allow.
grant execute on function public.auto_complete_order(uuid) to service_role;
