-- ============================================================================
-- ADM SECTION 4A — DISPUTE LIFECYCLE RPCs
-- (Admin Dashboard PRD — Section 4, items 1-3; rulings ADM-1, ADM-3, ADM-5, ADM-7)
--
-- Items 4-7 (moderation, boost termination, PII read) are 4B and item 8 (the
-- ADM-11 payout hold) is 4C. Neither is in this migration.
--
-- ADM-7: no role holds UPDATE or DELETE on public.disputes. These three
-- functions are the only way its status ever changes. That absence is the
-- guarantee; these are the deliberate exceptions to it — the same arrangement
-- as payouts and transition_payout_status (20260731110000:108-113).
--
-- ADM-5: every ADMIN mutation writes its own admin_actions row INSIDE the same
-- function body. If the mutation succeeded, the log row exists — there is no
-- ordering, no second call, and no code path that mutates without logging.
-- open_dispute is a BUYER action and deliberately writes no audit row.
--
-- ---------------------------------------------------------------------------
-- WHY THE ADMIN FUNCTIONS ARE GRANTED TO `authenticated`
--
-- `admin` is not a Postgres role. It is a value in profiles.role, checked by
-- public.is_admin(). Postgres grants are per database role — anon,
-- authenticated, service_role — so "EXECUTE for admins only" is not expressible
-- as a grant at all.
--
-- Confirmed by survey against live catalog state rather than assumed: every
-- SECURITY DEFINER function on this project that is NOT executable by
-- `authenticated` is restricted to service_role or to the owner — server-side
-- machinery (finalize_order_payment, transition_payout_status,
-- payout_sweep_candidates, auto_complete_order, expire_pending_order,
-- set_order_authorization_url, transition_boost_status) and trigger bodies
-- (handle_new_user, boosts_*). There is no existing admin-only EXECUTE
-- mechanism to follow, because there cannot be one.
--
-- So the gate is the in-body is_admin() check, which every admin_* function
-- performs FIRST, before touching any row. EXECUTE is granted to authenticated
-- because an admin arrives as an ordinary authenticated session.
--
-- ---------------------------------------------------------------------------
-- ERROR CONVENTION, following submit_seller_response (20260805120000) and
-- transition_payout_status (20260731110000):
--
--   42501  authorization refused  — not signed in, not the buyer, not an admin
--   P0001  business rule refused  — illegal transition, bad argument
--   P0002  referenced row absent
--
-- Callers get a stable snake_case token, never a raw constraint violation. The
-- SQLSTATE is what tests classify on; the token is for humans.
-- ============================================================================


-- ---- 1. open_dispute — the buyer action ------------------------------------
create or replace function public.open_dispute(
  p_order_id uuid,
  p_reason   text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   public.orders;
  v_dispute uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Mirrors the table CHECK (char_length between 10 and 2000) so a short reason
  -- returns a clean token instead of a raw check violation. Trimmed first, so
  -- two thousand spaces is not a valid reason.
  if p_reason is null
     or char_length(btrim(p_reason)) < 10
     or char_length(btrim(p_reason)) > 2000 then
    raise exception 'reason_out_of_bounds' using errcode = 'P0001';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  -- ADM-1 — BUYER-INITIATED ONLY. The seller on the order cannot open one, and
  -- neither can an unrelated user. Seller-initiated disputes are recorded as
  -- future work, not silently permitted here.
  if v_order.buyer_id <> auth.uid() then
    raise exception 'not_order_buyer' using errcode = '42501';
  end if;

  -- Money must have moved. 'paid' and 'completed' are the two states where the
  -- buyer has been charged; pending_payment, cancelled and expired have nothing
  -- to dispute. Confirmed against the live order_status enum
  -- (pending_payment, paid, completed, cancelled, expired) rather than against
  -- initial_schema, which carried a different set before checkout re-created it.
  if v_order.status not in ('paid', 'completed') then
    raise exception 'order_not_disputable' using errcode = 'P0001';
  end if;

  -- ADM-1 — at most one LIVE dispute per order. The partial unique index
  -- disputes_one_live_per_order is the authoritative guard; this block only
  -- translates its 23505 into the same token vocabulary as everything else.
  -- Scoped to the INSERT so it cannot swallow an unrelated unique violation.
  begin
    insert into public.disputes (order_id, opened_by, reason)
    values (p_order_id, auth.uid(), btrim(p_reason))
    returning id into v_dispute;
  exception
    when unique_violation then
      raise exception 'dispute_already_live' using errcode = 'P0001';
  end;

  -- No admin_actions row: this is a buyer action, not an admin one (ADM-5).
  return v_dispute;
end;
$$;

comment on function public.open_dispute(uuid, text) is
  'Buyer opens a dispute on their own paid/completed order (ADM-1). One live '
  'dispute per order, enforced by the partial unique index. Writes no '
  'admin_actions row — this is not an admin action.';


-- ---- 2. admin_review_dispute — open -> under_review ------------------------
create or replace function public.admin_review_dispute(p_dispute_id uuid)
returns public.disputes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispute public.disputes;
begin
  -- The gate, first and before any row is touched.
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  -- The from-status is guarded IN the UPDATE rather than by a preceding SELECT.
  -- One statement authorizes the write, so two admins clicking at once cannot
  -- both pass a check and then both write — the second matches zero rows. Same
  -- pattern as submit_seller_response (20260805120000).
  update public.disputes
     set status = 'under_review'
   where id = p_dispute_id
     and status = 'open'
  returning * into v_dispute;

  -- Deliberately one token for both "no such dispute" and "wrong state": the
  -- caller is an admin either way, and collapsing them keeps the atomic
  -- single-statement guard rather than reintroducing a check-then-act race.
  if not found then
    raise exception 'dispute_not_reviewable' using errcode = 'P0001';
  end if;

  -- ADM-5 — same function body, after a mutation that definitely happened.
  insert into public.admin_actions (actor_id, action_type, target_table, target_id, detail)
  values (
    auth.uid(),
    'dispute_review',
    'disputes',
    p_dispute_id,
    jsonb_build_object('from_status', 'open', 'to_status', 'under_review')
  );

  return v_dispute;
end;
$$;

comment on function public.admin_review_dispute(uuid) is
  'Admin moves a dispute open -> under_review (ADM-1). Admin-gated in body '
  'because `admin` is not a Postgres role. Writes its own admin_actions row '
  '(ADM-5).';


-- ---- 3. admin_resolve_dispute — under_review -> resolved_* -----------------
create or replace function public.admin_resolve_dispute(
  p_dispute_id       uuid,
  p_outcome          text,
  p_resolution_note  text,
  p_refund_reference text default null
)
returns public.disputes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispute public.disputes;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  if p_outcome is null or p_outcome not in ('resolved_refunded', 'resolved_rejected') then
    raise exception 'invalid_outcome' using errcode = 'P0001';
  end if;

  -- ADM-3 — refunds are MANUAL this phase. A refunded resolution must carry the
  -- reference of a refund the admin already performed in the Paystack
  -- dashboard; there is no refund API call anywhere in this phase. The
  -- symmetric rule matters as much: a REJECTED dispute must not carry one, or
  -- the audit trail would suggest money moved when none did.
  if p_outcome = 'resolved_refunded'
     and (p_refund_reference is null or btrim(p_refund_reference) = '') then
    raise exception 'refund_reference_required' using errcode = 'P0001';
  end if;

  if p_outcome = 'resolved_rejected' and p_refund_reference is not null then
    raise exception 'refund_reference_not_allowed' using errcode = 'P0001';
  end if;

  -- under_review is the only legal from-state: a dispute cannot jump from open
  -- straight to resolved, and a resolved one cannot be resolved again. Guarded
  -- in the statement, as above.
  update public.disputes
     set status           = p_outcome,
         resolution_note  = nullif(btrim(coalesce(p_resolution_note, '')), ''),
         refund_reference = case
                              when p_outcome = 'resolved_refunded'
                              then btrim(p_refund_reference)
                              else null
                            end,
         resolved_by      = auth.uid(),
         resolved_at      = now()
   where id = p_dispute_id
     and status = 'under_review'
  returning * into v_dispute;

  if not found then
    raise exception 'dispute_not_resolvable' using errcode = 'P0001';
  end if;

  -- ADM-5. action_type distinguishes the two outcomes, and detail carries the
  -- refund reference as STORED (null for a rejection) rather than as passed.
  insert into public.admin_actions (actor_id, action_type, target_table, target_id, detail)
  values (
    auth.uid(),
    case p_outcome
      when 'resolved_refunded' then 'dispute_resolve_refunded'
      else 'dispute_resolve_rejected'
    end,
    'disputes',
    p_dispute_id,
    jsonb_build_object(
      'from_status',      'under_review',
      'outcome',          p_outcome,
      'refund_reference', v_dispute.refund_reference
    )
  );

  return v_dispute;
end;
$$;

comment on function public.admin_resolve_dispute(uuid, text, text, text) is
  'Admin resolves a dispute under_review -> resolved_refunded | '
  'resolved_rejected (ADM-1). refund_reference is REQUIRED for a refund and '
  'FORBIDDEN for a rejection (ADM-3, manual refunds). Writes its own '
  'admin_actions row (ADM-5).';


-- ---- Grants (revoke-then-grant) --------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default, so granting alone would leave
-- that default standing — the function-level shape of the omission BST-17/18
-- closed on tables. Revoke first, every time.
--
-- authenticated only. anon cannot hold these: an unauthenticated caller has no
-- auth.uid() and would fail the first guard anyway, but the grant is the outer
-- wall. service_role does not need them either — it bypasses RLS and holds
-- direct INSERT on disputes for the machinery paths.
revoke all on function public.open_dispute(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.open_dispute(uuid, text) to authenticated;

revoke all on function public.admin_review_dispute(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_review_dispute(uuid) to authenticated;

revoke all on function public.admin_resolve_dispute(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_resolve_dispute(uuid, text, text, text) to authenticated;
