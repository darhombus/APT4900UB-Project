-- ============================================================================
-- NOTIFICATIONS — the in-app inbox, its read-marking RPCs, and the email toggle
-- (Notifications PRD — Section 2; NTF-4, NTF-5, NTF-6, NTF-7, NTF-16, NTF-18)
--
-- Four concerns in one migration because they are one schema change: the table
-- cannot ship without its grants, the grants cannot be exercised without the
-- read-marking RPCs, and the toggle the email half reads is a column on an
-- existing table that the same phase introduces.
--
-- THE SHAPE, in one sentence: `authenticated` may READ its own notifications and
-- may mark them read through two definer functions — and may do nothing else to
-- the table at all. Every row is written by service_role inside an Inngest
-- handler (NTF-7); nothing in the request path inserts here.
-- ============================================================================

-- ---- 1. The table (NTF-5, NTF-7) -------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,

  -- CHECK rather than an enum, deliberately. The v1 catalog (NTF-2) is seven
  -- strings that the application already knows by name; an enum would buy type
  -- safety at the cost of an ALTER TYPE — which cannot run inside a transaction
  -- with other DDL — every time the catalog grows. A CHECK is edited by a new
  -- migration like any other constraint.
  type       text not null check (type in (
               'order.paid',
               'order.completed',
               'payout.sent',
               'review.received',
               'review.response',
               'boost.activated',
               'boost.expiring_24h'
             )),

  -- Rendering data for the row: title/body fragments and the ids the inbox
  -- links to. Deliberately NOT a foreign key to anything — one table cannot
  -- reference orders, reviews, payouts and boosts at once, and a notification
  -- must survive its source being deleted (NTF-12 makes these immutable).
  payload    jsonb not null default '{}'::jsonb,

  -- The idempotency handle (NTF-7, NTF-17). Derived from the SOURCE ENTITY, not
  -- from the event delivery: order id for order.paid / order.completed, order id
  -- for review.received (one-review-per-order makes it unique without changing
  -- insertReview's return contract), review id for review.response, boost id for
  -- the two boost events, payout id for payout.sent.
  dedupe_key text not null,

  -- Null means unread. A nullable timestamp rather than a boolean + timestamp
  -- pair: one column cannot disagree with itself, and it is what the partial
  -- index below keys on.
  read_at    timestamptz,
  created_at timestamptz not null default now(),

  -- THE IDEMPOTENCY GUARANTEE (NTF-7). Data-enforced, not handler-enforced:
  -- Inngest retries, a webhook and a callback settling the same reference, and
  -- the dual order.completed emission (NTF-17) all collapse here, in the
  -- database, on conflict-no-op. A handler that forgets to be careful still
  -- cannot create a second row.
  --
  -- (user_id, type, dedupe_key) and not (type, dedupe_key): order.paid notifies
  -- BOTH parties off one order id, and those are two legitimate rows.
  constraint notifications_dedupe unique (user_id, type, dedupe_key)
);

comment on table public.notifications is
  'In-app notification inbox (Notifications PRD, NTF-5). Rows are created only '
  'by service_role inside Inngest handlers; `authenticated` holds SELECT and '
  'nothing else, and marks rows read through mark_notification_read / '
  'mark_all_notifications_read. Immutable except read_at (NTF-12).';

comment on column public.notifications.dedupe_key is
  'Derived from the source entity, never from the event delivery — see NTF-17. '
  'Half of the unique constraint that makes handler retries no-ops.';

-- ---- 2. Indexes (NTF-5, NTF-10) --------------------------------------------
-- The unread count behind the header badge, which runs on every navigation
-- fallback and after every Realtime nudge. Partial, so it holds only the rows
-- the count is about: a user who reads their inbox drops out of it entirely, and
-- for the common case (nothing unread) the index is empty for that user.
create index notifications_user_unread
  on public.notifications (user_id)
  where read_at is null;

-- NO SEPARATE (user_id, created_at) INDEX, deliberately. The inbox list filters
-- on user_id and sorts by created_at desc, which looks like it wants one — but
-- `notifications_dedupe` above is a unique INDEX with user_id as its leading
-- column, so the filter is already served. What remains is a sort over one
-- user's own notifications, which is small by construction. Adding a third index
-- would cost every insert a write to buy nothing measurable at this size.

-- ---- 3. RLS (NTF-5) --------------------------------------------------------
-- NOTE ON `FORCE ROW LEVEL SECURITY`, which profiles_private sets and this table
-- deliberately does NOT.
--
-- There, FORCE was belt-and-braces: inert today (postgres and service_role both
-- carry BYPASSRLS) and harmless if it ever became effective, because that table
-- has own-row INSERT and UPDATE policies for the roles that write it.
--
-- Here it would be a trap. This table has exactly ONE policy — SELECT — because
-- NTF-6 puts every write behind a SECURITY DEFINER function, and those run as
-- the table's owner. If the owner ever lost BYPASSRLS, FORCE would subject those
-- functions to a policy set containing no UPDATE policy at all: the read-marking
-- UPDATE would match zero rows and return cleanly. The badge would stop clearing
-- and nothing would throw. A silent no-op is a worse failure than the exposure
-- FORCE would be guarding against, and the guard is unnecessary anyway — the
-- grants below are what stop `authenticated` writing here, and privilege is
-- checked before policy.
alter table public.notifications enable row level security;

-- Own row, SELECT only. Realtime evaluates this same policy per subscriber
-- against their JWT (the messaging precedent), so an unfiltered INSERT
-- subscription in the browser only ever delivers the subscriber's own rows.
--
-- (select auth.uid()) rather than a bare auth.uid(): the subselect is evaluated
-- once per statement instead of once per row, which is the difference that
-- matters on the inbox list query.
create policy notifications_select on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

-- No INSERT/UPDATE/DELETE policy of any scoping, and no anon policy of any kind.
-- Both absences are load-bearing rather than oversights: combined with the
-- grants below, an anon read and an authenticated write each fail on PRIVILEGE
-- (42501) before RLS is consulted — a hard error, not an empty result that would
-- read as "no notifications" and hide a broken query for a release or two.

-- ---- 4. Table grants (NTF-5) -----------------------------------------------
-- STANDING LESSON (checkout grants hardening, 20260730140000): on this project a
-- new public table needs REVOKE-then-GRANT, not GRANT alone. The hosted project
-- carries `alter default privileges ... grant all on tables to anon,
-- authenticated, service_role`, so a new table is born with full DML for every
-- role — granting alone is silently correct locally and silently wrong hosted.
revoke all on public.notifications from anon, authenticated, service_role;

-- The whole of the client write surface: nothing. SELECT is the only verb, and
-- read-marking goes through the functions in section 5 (NTF-6). This is the
-- BST-15/16 lesson applied from birth rather than retrofitted — there is no
-- table-wide grant here to close later.
grant select on public.notifications to authenticated;

-- service_role holds the DML per NTF-5: INSERT for the handlers, DELETE for the
-- NTF-11 retention cron. UPDATE is granted because NTF-5 specifies it, though
-- nothing in this phase uses it — read-marking runs as the function owner, not
-- as service_role, and NTF-12 makes every other column immutable.
grant select, insert, update, delete on public.notifications to service_role;

-- anon: nothing at all, not even SELECT.

-- ---- 5. Read marking (NTF-6) -----------------------------------------------
-- Two functions rather than an UPDATE policy, because an UPDATE policy needs an
-- UPDATE grant, and a column-scoped `grant update (read_at)` would still let a
-- caller set read_at to any value they like on any of their own rows — including
-- back to null, or to a forged timestamp. The function sets `now()` and only
-- where the row is currently unread, so the value is the server's and the
-- transition is one-way.

create or replace function public.mark_notification_read(p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Every authorizing condition lives in this one statement, the
  -- submit_seller_response pattern: the caller owns the row, and it is not
  -- already read. A notification belonging to someone else matches zero rows and
  -- returns false — the caller learns nothing about whether it exists.
  update public.notifications
     set read_at = now()
   where id = p_notification_id
     and user_id = auth.uid()
     and read_at is null;

  -- IDEMPOTENT BY THE PREDICATE, not by a prior SELECT (NTF-6). A second call
  -- matches nothing and returns false. False is a normal outcome — "already
  -- read", "not yours", "gone" — never an error, so the UI can fire this on
  -- every open without branching.
  return found;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  update public.notifications
     set read_at = now()
   where user_id = auth.uid()
     and read_at is null;

  get diagnostics v_count = row_count;
  -- How many were cleared, so the caller can zero its badge store without a
  -- follow-up count query. Zero is a normal answer.
  return v_count;
end;
$$;

-- Function grant hardening, mirroring 20260731140000 and the reviews phase:
-- revoke from PUBLIC (and from the roles hosted default privileges may have
-- handed it to) before granting, so local and hosted end up with the same
-- EXECUTE matrix.
--
-- service_role gets nothing, deliberately and per the reviews precedent: it has
-- no session, so auth.uid() is null and the call could only ever raise. A
-- handler needing to mark something read would use its own UPDATE grant.
revoke execute on function public.mark_notification_read(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_notification_read(uuid)
  to authenticated;

revoke execute on function public.mark_all_notifications_read()
  from public, anon, authenticated, service_role;
grant execute on function public.mark_all_notifications_read()
  to authenticated;

-- ---- 6. The email toggle (NTF-4) -------------------------------------------
-- One global boolean, default true. Per-event granularity is deferred (NTF-14),
-- and transactional mail ignores this column entirely (NTF-3 as amended): it is
-- consulted only for the four non-transactional events.
--
-- `not null default true` backfills every existing row in place, so the backfill
-- travels with the schema change exactly as the reviews and PII phases required.
--
-- NTF-4 COROLLARY, enforced in application code rather than here: an ABSENT
-- profiles_private row reads as email_activity = true at send time. Absence is a
-- valid state on this table (PII D3) — a user who never saved a phone has no row
-- — so the send path must coalesce, not assume a row exists. No row is created
-- here for anyone; that would encode the state D3 says should not exist.
alter table public.profiles_private
  add column email_activity boolean not null default true;

comment on column public.profiles_private.email_activity is
  'Global "email me about activity" toggle (NTF-4). Consulted only for '
  'non-transactional events; NTF-3 transactional mail ignores it. An absent '
  'profiles_private row means true.';

-- ---- 7. profiles_private write allowlist (NTF-16) --------------------------
-- The BST-15/16 standard, applied to the third and last user-writable table.
--
-- THE EXPOSURE this closes, verified on the local stack before this migration:
--
--   profiles_private | authenticated | INSERT, SELECT, UPDATE
--
-- — table-level, from 20260808100000_profiles_private_split.sql, which granted
-- the verbs but not the columns. That was correct for a table whose every column
-- was user-owned data. It stops being correct the moment section 6 above adds a
-- column, because table-level UPDATE covers columns that do not exist yet: any
-- column any later phase adds here is writable by the row's owner from the
-- instant it is created, with no migration ever mentioning it.
--
-- `email_activity` is itself harmless to self-write — that is the whole point of
-- the toggle. What is not harmless is the standing invitation. BST-16 closed
-- exactly this on `profiles` and BST-15 on `listings`; this table was left with
-- a table-wide grant only because nothing had yet been added to it.
--
-- REVOKE the two DML verbs, not `all`: SELECT is untouched (own-row RLS already
-- scopes it, and the column set it may read is deliberately the whole row).
revoke insert, update on public.profiles_private from authenticated;

-- INSERT carries `id` — the account settings upsert supplies it, and the
-- profiles_private_insert policy checks it equals auth.uid(), so a caller cannot
-- upsert a row onto anyone else.
grant insert (
  id,
  phone,
  location,
  email_activity
) on public.profiles_private to authenticated;

-- UPDATE drops `id`: reassigning a row's identity is meaningless at best and a
-- collision at worst. The account settings upsert's ON CONFLICT DO UPDATE half
-- only ever assigns phone and location, so it is unaffected.
grant update (
  phone,
  location,
  email_activity
) on public.profiles_private to authenticated;

-- WHAT IS DELIBERATELY ABSENT:
--
--   updated_at   set by the profiles_private_updated_at BEFORE trigger. Column
--                privileges are checked against the STATEMENT's target list, not
--                against what a trigger assigns, so the trigger keeps working
--                without a grant — the same reasoning as BST-16's note on
--                profiles.updated_at.
--   id (UPDATE)  see above.
--
-- service_role keeps table-level `grant all` untouched: handle_new_user and the
-- e2e fixtures continue to work unchanged. `anon` holds nothing here and still
-- does — an anon attempt fails on privilege, not on policy.

-- ---- 8. Realtime (NTF-18) --------------------------------------------------
-- The live badge subscribes to INSERTs on this table (NTF-10). RLS still
-- applies: Realtime evaluates notifications_select per subscriber against their
-- JWT, so a subscriber receives only their own rows and the browser-side
-- subscription needs no filter to be safe.
--
-- INSERT-only subscriptions need no REPLICA IDENTITY change (default = primary
-- key). Guarded exactly as messaging_schema.sql:245-250 guards `messages`: the
-- publication does not exist on every stack, and adding a table twice is an
-- error, so both conditions are checked before the ALTER.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
