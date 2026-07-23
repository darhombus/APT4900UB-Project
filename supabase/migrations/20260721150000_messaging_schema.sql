-- ============================================================================
-- MESSAGING SCHEMA (Messaging PRD — Section 2)
--
-- The `conversations` and `messages` tables, `is_conversation_participant()`,
-- and their RLS policies already ship from the setup phase
-- (20260710013856_initial_schema, 20260710015112_rls_policies) on a per-message
-- `read_at` model. Per the confirmed rulings (survey D-0/D-1/D-3), this migration
-- ALTERS that shipped schema to the messaging PRD's target shape rather than
-- creating tables (standing rule: never edit applied migrations):
--   * conversations gains `seller_id` (stored per D2), `last_message_at`, and the
--     two last-read timestamps; + a buyer<>seller check; + activity indexes.
--   * messages drops `read_at` (D5/D6: unread lives on the conversation row and
--     messages are immutable) and switches its body check to trimmed length.
--   * a message-insert trigger advances `last_message_at` and the sender's own
--     last-read (a sender has read their own message).
--   * RLS: starting is ACTIVE-only (D3) and pins seller_id = the listing owner;
--     sending is allowed while active/paused/sold; the messages UPDATE policy is
--     dropped (D6, immutable); a guard trigger holds a participant to only their
--     own last-read column; anon is denied outright.
--   * messages is added to the `supabase_realtime` publication.
-- Both tables are empty (feature unbuilt), so the column adds/backfill are safe.
-- Idempotent throughout: guarded adds / drop-if-exists / create-or-replace.
-- ============================================================================

-- ---- conversations: new columns -------------------------------------------
alter table public.conversations
  add column if not exists seller_id uuid references public.profiles (id) on delete cascade;

-- Backfill seller_id from the listing (D2: seller derived from the listing).
-- A no-op on the empty local table; correct for any pre-existing row.
update public.conversations c
   set seller_id = l.seller_id
  from public.listings l
 where l.id = c.listing_id and c.seller_id is null;

alter table public.conversations
  alter column seller_id set not null;

alter table public.conversations
  add column if not exists last_message_at     timestamptz not null default now(),
  add column if not exists buyer_last_read_at  timestamptz not null default now(),
  add column if not exists seller_last_read_at timestamptz not null default now();

-- buyer <> seller (ADD CONSTRAINT has no IF NOT EXISTS, so guard it).
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'conversations_buyer_ne_seller'
      and conrelid = 'public.conversations'::regclass
  ) then
    alter table public.conversations
      add constraint conversations_buyer_ne_seller check (buyer_id <> seller_id);
  end if;
end $$;

-- Conversation-list indexes; the composite (buyer_id, last_message_at desc)
-- supersedes the plain buyer_id index from the initial schema.
drop index if exists public.conversations_buyer_idx;
create index if not exists conversations_buyer_activity_idx
  on public.conversations (buyer_id, last_message_at desc);
create index if not exists conversations_seller_activity_idx
  on public.conversations (seller_id, last_message_at desc);

-- ---- messages: drop read_at, trim the body check --------------------------
alter table public.messages drop column if exists read_at;

alter table public.messages drop constraint if exists messages_body_check;
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'messages_body_length'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_body_length check (char_length(btrim(body)) between 1 and 2000);
  end if;
end $$;

-- ---- trigger: a new message advances its conversation ----------------------
-- SECURITY DEFINER so the UPDATE bypasses the conversations RLS + guard: it sets
-- last_message_at and the SENDER's own last-read (a sender has read their own
-- message). Running as the table owner makes the guard trigger's current_user
-- check trust it wholesale.
create or replace function public.messages_touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
     set last_message_at     = new.created_at,
         buyer_last_read_at  = case when buyer_id  = new.sender_id then new.created_at else buyer_last_read_at  end,
         seller_last_read_at = case when seller_id = new.sender_id then new.created_at else seller_last_read_at end
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.messages_touch_conversation();

-- ---- guard: a participant may move ONLY their own last-read column ----------
-- The UPDATE policy below authorizes the ROW (participant); this trigger
-- authorizes the COLUMNS. Internal/privileged writers — the SECURITY DEFINER
-- message trigger (runs as the table owner) and service_role — are trusted
-- wholesale; a PostgREST client update always runs as the `authenticated` role.
create or replace function public.conversations_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'authenticated' then
    return new;  -- message trigger / service role / migrations
  end if;

  if new.id              is distinct from old.id
     or new.listing_id      is distinct from old.listing_id
     or new.buyer_id        is distinct from old.buyer_id
     or new.seller_id       is distinct from old.seller_id
     or new.created_at      is distinct from old.created_at
     or new.last_message_at is distinct from old.last_message_at then
    raise exception 'conversations: only your own last-read timestamp may be updated';
  end if;

  if auth.uid() = old.buyer_id then
    if new.seller_last_read_at is distinct from old.seller_last_read_at then
      raise exception 'conversations: a buyer cannot move the seller last-read timestamp';
    end if;
  elsif auth.uid() = old.seller_id then
    if new.buyer_last_read_at is distinct from old.buyer_last_read_at then
      raise exception 'conversations: a seller cannot move the buyer last-read timestamp';
    end if;
  else
    raise exception 'conversations: not a participant';
  end if;

  return new;
end;
$$;

drop trigger if exists conversations_guard_update on public.conversations;
create trigger conversations_guard_update
  before update on public.conversations
  for each row execute function public.conversations_guard_update();

-- ---- RLS: reconcile the shipped policies to the PRD ------------------------
-- conversations SELECT/UPDATE now key off the stored buyer_id/seller_id columns
-- directly (participant or admin) instead of is_conversation_participant(id),
-- which re-queries the conversations table. That indirection predates D2 storing
-- seller_id on the row, and — because the function can't see a row mid-INSERT —
-- it made `INSERT ... RETURNING` (the idiomatic supabase-js `.insert().select()`)
-- fail the SELECT check with an RLS error. Direct column refs are visible during
-- RETURNING, so they fix that and are cheaper. messages_select keeps the function
-- (it must look up the parent conversation, which already exists, so RETURNING is
-- unaffected there).
drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select using (
    buyer_id = auth.uid() or seller_id = auth.uid() or public.is_admin()
  );

-- Starting a conversation is ACTIVE-only (D3): the buyer is the caller, the
-- stored seller_id must equal the listing's real owner (rejects a forged
-- seller_id), and the buyer is not the owner.
drop policy if exists conversations_insert on public.conversations;
create policy conversations_insert on public.conversations
  for insert to authenticated
  with check (
    conversations.buyer_id = auth.uid()
    and exists (
      select 1 from public.listings l
      where l.id = conversations.listing_id
        and l.status = 'active'
        and l.seller_id = conversations.seller_id
        and l.seller_id <> auth.uid()
    )
  );

-- A participant may update their own conversation row; the guard trigger above
-- restricts which columns actually change.
drop policy if exists conversations_update on public.conversations;
create policy conversations_update on public.conversations
  for update to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid())
  with check (buyer_id = auth.uid() or seller_id = auth.uid());

-- Sending is allowed while the listing is active, paused, or sold (D3): a paused
-- or sold thread can still be continued; deleted/removed blocks the composer.
--
-- The status check runs through a SECURITY DEFINER helper (like
-- is_conversation_participant) rather than an inline `join listings`. An inline
-- subquery in an RLS policy is itself subject to the referenced table's RLS, and
-- listings_select hides a PAUSED listing from the non-owner buyer — so an inline
-- join would evaluate false and wrongly block the buyer's paused/resume send
-- (the exact D3 case). Running as the function owner bypasses listings RLS, so
-- the policy tests the listing's true status, not the caller's visibility of it.
create or replace function public.conversation_is_sendable(p_conversation_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.conversations c
    join public.listings l on l.id = c.listing_id
    where c.id = p_conversation_id
      and l.status in ('active', 'paused', 'sold')
  );
$$;

grant execute on function public.conversation_is_sendable(uuid) to authenticated, service_role;

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    messages.sender_id = auth.uid()
    and public.is_conversation_participant(messages.conversation_id)
    and public.conversation_is_sendable(messages.conversation_id)
  );

-- D6: messages are immutable — no UPDATE (or DELETE) policy under any scoping.
-- The shipped read_at UPDATE policy is removed; read tracking lives on the
-- conversation row.
drop policy if exists messages_update on public.messages;

-- ---- Deny anonymous access to both tables entirely -------------------------
-- The setup grant handed anon SELECT on every table; revoke it here so anon gets
-- a hard permission error (like payments), not a silently empty result.
revoke all on table public.conversations from anon;
revoke all on table public.messages from anon;

-- ---- Realtime: broadcast message inserts to authenticated participants ------
-- RLS still applies: Realtime evaluates the messages SELECT policy per subscriber
-- (against their JWT), so only conversation participants receive an insert.
-- INSERT-only subscriptions need no REPLICA IDENTITY change (default = primary
-- key). See the DEVLOG for the RLS-enforcement note.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
     ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
