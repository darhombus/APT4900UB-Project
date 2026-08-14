-- ============================================================================
-- ADM SCHEMA B — ADMIN_ACTIONS (the immutable audit log)
-- (Admin Dashboard PRD — Section 3; ruling ADM-5)
--
-- ADM-5: immutability is enforced at the PRIVILEGE level. UPDATE and DELETE are
-- withheld from every grantable runtime role — anon, authenticated AND
-- service_role. There is no "the server can fix it up" path, by construction.
--
-- SCOPE NOTE, stated plainly because the word "immutable" invites a stronger
-- reading than the mechanism supports: the table owner under which migrations
-- run bypasses grants, and `force` RLS does not bind it either (on this project
-- `postgres` carries BYPASSRLS outright). Immutability here is enforced against
-- RUNTIME access, not against DDL. A future migration can still rewrite this
-- table; nothing reachable from the application can.
--
-- The pattern is the payouts one (20260731110000:108-113): no role holds the
-- write privilege, and a SECURITY DEFINER function owned by postgres is the
-- single deliberate exception. Here that exception is the Section 4 admin RPCs,
-- each of which writes its own row INSIDE its own function body — so an action
-- that succeeds has a log row, and there is no code path that mutates without
-- logging.
-- ============================================================================

create table public.admin_actions (
  id           uuid primary key default gen_random_uuid(),

  -- The acting admin. Deliberately NOT a foreign key: an audit row must survive
  -- the deletion of the actor it records, and profiles cascade from auth.users.
  -- The same reasoning the notifications payload uses for its ids
  -- (20260811150000:38-40).
  actor_id     uuid not null,

  action_type  text not null check (action_type in (
                 'dispute_review',
                 'dispute_resolve_refunded',
                 'dispute_resolve_rejected',
                 'listing_takedown',
                 'listing_restore',
                 'review_hide',
                 'review_restore',
                 'boost_terminate',
                 'pii_read'
               )),

  -- Target as (table, id) rather than a column per entity type: one log spans
  -- disputes, listings, reviews, boosts and profiles_private, and a FK to any
  -- one of them would be a FK to none of the others.
  target_table text not null,
  target_id    uuid not null,

  -- Per-action context: prior/new status for the moderation actions, outcome
  -- and refund_reference for a dispute resolution, original expiry for a boost
  -- termination, the moderation note for a takedown.
  detail       jsonb not null default '{}'::jsonb,

  created_at   timestamptz not null default now()
);

comment on table public.admin_actions is
  'Immutable audit trail of admin mutations (ADM-5). UPDATE and DELETE are '
  'withheld from anon, authenticated AND service_role; rows are written only '
  'inside the Section 4 SECURITY DEFINER RPCs, in the same function body as '
  'the mutation they record. Immutable against runtime access, not against DDL.';

-- The /admin/actions view (Section 5) is newest-first, filterable by type.
create index admin_actions_created_idx
  on public.admin_actions (created_at desc);

create index admin_actions_type_created_idx
  on public.admin_actions (action_type, created_at desc);

-- Reading the history of one entity — e.g. every takedown/restore on a listing.
create index admin_actions_target_idx
  on public.admin_actions (target_table, target_id, created_at desc);


-- ---- Grants (ADM-5) --------------------------------------------------------
-- Revoke-then-grant, per the standing pattern and the hosted-vs-local lesson at
-- 20260730140000:39-45.
--
-- The asymmetry IS the immutability:
--   authenticated  SELECT only        — narrowed to admins by the policy below
--   service_role   SELECT, INSERT     — append-only; note service_role holds
--                                       BYPASSRLS, so grants are its whole
--                                       access story
--   anon           nothing
--   NOBODY         UPDATE or DELETE   — including service_role (ADM-5)
revoke all on public.admin_actions from anon, authenticated, service_role;

grant select         on public.admin_actions to authenticated;
grant select, insert on public.admin_actions to service_role;


-- ---- RLS -------------------------------------------------------------------
alter table public.admin_actions enable row level security;
alter table public.admin_actions force  row level security;

-- Admins only. Non-admin `authenticated` callers hold the SELECT privilege but
-- match no rows — the audit log is not a user-facing surface.
create policy admin_actions_select on public.admin_actions
  for select to authenticated
  using (public.is_admin());

-- No INSERT policy: inserts arrive via service_role (BYPASSRLS) and the Section
-- 4 definer RPCs. No UPDATE or DELETE policy, and no grant to pair one with.
