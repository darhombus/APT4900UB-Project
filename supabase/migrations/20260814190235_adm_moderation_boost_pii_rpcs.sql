-- ============================================================================
-- ADM SECTION 4B — MODERATION, BOOST TERMINATION, PII READ
-- (Admin Dashboard PRD — Section 4, items 4-7; rulings ADM-4, ADM-5, ADM-7,
--  ADM-10, ADM-13)
--
-- Item 8 (the ADM-11 payout hold) is 4C and is NOT in this migration.
--
-- Every function here follows the pattern ratified in 4A:
--   * SECURITY DEFINER with an explicit safe search_path
--   * the in-body public.is_admin() gate FIRST, before any row is touched —
--     `admin` is a profiles.role value, not a Postgres role, so admin-only
--     EXECUTE is not expressible as a grant and the gate must live in the body
--   * from-state guarded INSIDE the UPDATE, never by a preceding SELECT, so two
--     admins acting at once cannot both pass a check and both write
--   * an admin_actions row written in the SAME function body (ADM-5)
--   * revoke-then-grant, EXECUTE to authenticated only
--
-- Error convention, unchanged: 42501 authorization, P0001 business rule,
-- P0002 absent row.
-- ============================================================================


-- ---- 4. admin_set_listing_visibility (ADM-10, ADM-13) ----------------------
-- RETURNS the emission payload and EMITS NOTHING. The database has no outbound
-- HTTP — pg_trgm is the only extension in any migration on this project — and
-- every notification in this codebase is sent from TypeScript via the
-- notification-events.ts helpers. The ADM-13 'listing.removed' emission is
-- Section 5's server action, which uses this return value.
--
-- soft_delete_listing is deliberately NOT re-created. Verified against live
-- catalog state rather than migration text: its body carries
-- `and status in ('active', 'paused', 'sold')`, so a 'removed' listing already
-- falls outside its from-set and it returns false without acting. Adding a
-- redundant guard would be noise, and would imply a hole that is not there.
create or replace function public.admin_set_listing_visibility(
  p_listing_id uuid,
  p_action     text,
  p_note       text default null
)
returns table (
  seller_id       uuid,
  prior_status    public.listing_status,
  admin_action_id uuid,
  note            text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_id uuid;
  v_prior     public.listing_status;
  v_action_id uuid;
  v_note      text := nullif(btrim(coalesce(p_note, '')), '');
  v_status    public.listing_status;
  v_stash     public.listing_status;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  if p_action is null or p_action not in ('takedown', 'restore') then
    raise exception 'invalid_action' using errcode = 'P0001';
  end if;

  if p_action = 'takedown' then
    -- The stash is written from the OLD status: in an UPDATE the right-hand
    -- side of SET reads the pre-update row, so this captures where the listing
    -- was before the takedown. RETURNING then reads the NEW row, which is why
    -- it yields the stashed value rather than 'removed'.
    update public.listings
       set removed_prior_status = status,
           status               = 'removed'
     where id = p_listing_id
       and status <> 'removed'
    returning listings.seller_id, listings.removed_prior_status
         into v_seller_id, v_prior;

    if not found then
      -- Race-free diagnostic: the mutation has already failed, so re-reading
      -- cannot reintroduce a check-then-act window. It only sharpens the token.
      select l.status into v_status from public.listings l where l.id = p_listing_id;
      if not found then
        raise exception 'listing_not_found' using errcode = 'P0002';
      end if;
      raise exception 'listing_already_removed' using errcode = 'P0001';
    end if;

  else
    -- ADM-10: restore returns the listing to EXACTLY its stashed status. A
    -- listing taken down while 'sold' comes back 'sold', never 'active' —
    -- guessing a target would silently relist sold inventory. A null stash is
    -- refused rather than guessed at.
    update public.listings
       set status               = removed_prior_status,
           removed_prior_status = null
     where id = p_listing_id
       and status = 'removed'
       and removed_prior_status is not null
    returning listings.seller_id, 'removed'::public.listing_status
         into v_seller_id, v_prior;

    if not found then
      select l.status, l.removed_prior_status
        into v_status, v_stash
        from public.listings l
       where l.id = p_listing_id;

      if not found then
        raise exception 'listing_not_found' using errcode = 'P0002';
      elsif v_status <> 'removed' then
        raise exception 'listing_not_removed' using errcode = 'P0001';
      else
        -- Reachable for a row that reached 'removed' outside this RPC — e.g.
        -- data predating ADM-10. Distinguished from the above deliberately: an
        -- admin needs to know the difference between "not taken down" and
        -- "taken down but we do not know where to put it back".
        raise exception 'removed_prior_status_missing' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- ADM-5 — same body, after a mutation that definitely happened. p_note is
  -- carried into detail so the moderation reason is part of the audit record,
  -- not only of the notification.
  insert into public.admin_actions (actor_id, action_type, target_table, target_id, detail)
  values (
    auth.uid(),
    case p_action when 'takedown' then 'listing_takedown' else 'listing_restore' end,
    'listings',
    p_listing_id,
    jsonb_build_object(
      'prior_status', v_prior,
      'new_status',   case when p_action = 'takedown' then 'removed' else v_prior::text end,
      'note',         v_note
    )
  )
  returning id into v_action_id;

  return query select v_seller_id, v_prior, v_action_id, v_note;
end;
$$;

comment on function public.admin_set_listing_visibility(uuid, text, text) is
  'Admin takedown/restore using the existing ''removed'' status (ADM-10). '
  'Stashes the prior status on takedown and restores it exactly; refuses a null '
  'stash rather than guessing. RETURNS the ADM-13 emission payload and emits '
  'nothing — the database has no outbound HTTP. Writes its own admin_actions '
  'row (ADM-5).';


-- ---- 5. admin_set_review_status (ADM-4) ------------------------------------
-- SECURITY DEFINER is LOAD-BEARING here, not stylistic. Confirmed live:
-- `authenticated` holds no UPDATE privilege on public.reviews at all — only
-- service_role holds `update (status)`. Without definer rights this function
-- could not write the column even for an admin.
--
-- Operates on the EXISTING review_status enum ('visible','hidden'), confirmed
-- live. No new status values are invented.
create or replace function public.admin_set_review_status(
  p_review_id uuid,
  p_action    text
)
returns public.reviews
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.reviews;
  v_target public.review_status;
  v_from   public.review_status;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  if p_action is null or p_action not in ('hide', 'restore') then
    raise exception 'invalid_action' using errcode = 'P0001';
  end if;

  v_target := case p_action when 'hide' then 'hidden' else 'visible' end;
  v_from   := case p_action when 'hide' then 'visible' else 'hidden' end;

  -- From-state in the statement: hiding an already-hidden review, or restoring
  -- an already-visible one, matches zero rows and is refused. That also makes
  -- the audit log free of no-op entries.
  update public.reviews
     set status = v_target
   where id = p_review_id
     and status = v_from
  returning * into v_review;

  if not found then
    raise exception 'review_not_in_expected_state' using errcode = 'P0001';
  end if;

  insert into public.admin_actions (actor_id, action_type, target_table, target_id, detail)
  values (
    auth.uid(),
    case p_action when 'hide' then 'review_hide' else 'review_restore' end,
    'reviews',
    p_review_id,
    jsonb_build_object('from_status', v_from, 'to_status', v_target)
  );

  return v_review;
end;
$$;

comment on function public.admin_set_review_status(uuid, text) is
  'Admin hide/restore of a review using the existing review_status enum '
  '(ADM-4). SECURITY DEFINER is load-bearing: authenticated holds no UPDATE on '
  'reviews. Writes its own admin_actions row (ADM-5).';


-- ---- 6. admin_terminate_boost --------------------------------------------
-- Ends the boost the way natural expiry does: by moving expires_at into the
-- past-or-present and letting boosts_sync_listing_boosted_until() recompute
-- listings.boosted_until. Verified live, that trigger fires
-- `AFTER INSERT OR DELETE OR UPDATE OF status, expires_at` and recomputes
-- `max(expires_at) where status = 'active'`, so touching expires_at alone is
-- sufficient — elevation is gated on `boosted_until > now()`.
--
-- status is deliberately NOT set to 'expired'. The expireBoost Inngest job
-- tidies status and is not what stops a boost (search_listings_boost_rank
-- documents this); leaving status alone means downstream ranking behaves
-- IDENTICALLY to natural expiry rather than merely similarly.
--
-- WHY greatest(): the boosts table carries
-- `check (expires_at > starts_at)`. A boost activated moments ago has
-- starts_at ≈ now(), so a bare `expires_at = now()` would violate that
-- constraint and fail — terminating a just-activated spam boost is exactly when
-- an admin needs this most. The earliest legal expiry is therefore an instant
-- after starts_at.
create or replace function public.admin_terminate_boost(p_boost_id uuid)
returns public.boosts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_boost    public.boosts;
  v_original timestamptz;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  select b.expires_at into v_original
    from public.boosts b
   where b.id = p_boost_id;

  update public.boosts
     set expires_at = greatest(now(), starts_at + interval '1 millisecond'),
         updated_at = now()
   where id = p_boost_id
     and status = 'active'
     and expires_at > now()
  returning * into v_boost;

  if not found then
    raise exception 'boost_not_terminable' using errcode = 'P0001';
  end if;

  insert into public.admin_actions (actor_id, action_type, target_table, target_id, detail)
  values (
    auth.uid(),
    'boost_terminate',
    'boosts',
    p_boost_id,
    jsonb_build_object(
      'original_expires_at', v_original,
      'new_expires_at',      v_boost.expires_at,
      'listing_id',          v_boost.listing_id
    )
  );

  return v_boost;
end;
$$;

comment on function public.admin_terminate_boost(uuid) is
  'Admin ends an active boost early by moving expires_at to now (ADM-4 scope). '
  'Leaves status alone so boosts_sync_listing_boosted_until() recomputes and '
  'ranking behaves identically to natural expiry. Writes its own admin_actions '
  'row (ADM-5).';


-- ---- 7. admin_read_private_profile ----------------------------------------
-- PII access is itself an audited admin action. The audit row is written on
-- EVERY call, INCLUDING one that returns no rows — an admin looking up a
-- profile that has no profiles_private row still looked, and PII D3 makes an
-- absent row a legitimate state rather than an error.
--
-- The audit INSERT deliberately precedes the read: an admin cannot obtain the
-- data and leave no trace, whatever happens afterwards.
--
-- An EXPLICIT column list, never select *. A future column added to
-- profiles_private must be a deliberate decision to expose, not something a
-- wildcard picks up silently.
create or replace function public.admin_read_private_profile(p_profile_id uuid)
returns table (
  id             uuid,
  phone          text,
  location       text,
  updated_at     timestamptz,
  email_activity boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  insert into public.admin_actions (actor_id, action_type, target_table, target_id, detail)
  values (
    auth.uid(),
    'pii_read',
    'profiles_private',
    p_profile_id,
    jsonb_build_object('reason', 'admin_reveal')
  );

  return query
    select pp.id, pp.phone, pp.location, pp.updated_at, pp.email_activity
      from public.profiles_private pp
     where pp.id = p_profile_id;
end;
$$;

comment on function public.admin_read_private_profile(uuid) is
  'Admin reveal of a profiles_private row. Writes a ''pii_read'' admin_actions '
  'row on EVERY call, before the read and including calls that return nothing '
  '(PII D3 makes an absent row valid). Explicit column list, never select *.';


-- ---- Grants (revoke-then-grant) --------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default; revoke first so that default
-- never stands. authenticated only — an admin arrives as an ordinary
-- authenticated session and the in-body gate is what distinguishes them.
revoke all on function public.admin_set_listing_visibility(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_listing_visibility(uuid, text, text) to authenticated;

revoke all on function public.admin_set_review_status(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_review_status(uuid, text) to authenticated;

revoke all on function public.admin_terminate_boost(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_terminate_boost(uuid) to authenticated;

revoke all on function public.admin_read_private_profile(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_read_private_profile(uuid) to authenticated;
