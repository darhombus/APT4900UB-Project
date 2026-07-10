-- ============================================================================
-- ROW LEVEL SECURITY
-- Server-side code using the service-role key bypasses RLS by design (payment
-- webhooks, order state machine, admin jobs). These policies protect everything
-- reachable with the anon / authenticated (user) key.
--
-- Convention here: SELECT policies are left open to `public` (so anon can browse
-- the marketplace); write policies are scoped `to authenticated`.
-- ============================================================================

-- ============ HELPER FUNCTIONS ============
-- SECURITY DEFINER so they read the underlying tables without triggering RLS
-- again (avoids recursive policy evaluation).

-- Is the current user an admin?
create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Is the current user a participant (buyer or the listing's seller) in a
-- conversation?
create or replace function public.is_conversation_participant(conv_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1
    from public.conversations c
    join public.listings l on l.id = c.listing_id
    where c.id = conv_id
      and (c.buyer_id = auth.uid() or l.seller_id = auth.uid())
  );
$$;

-- ============ ENABLE RLS ON ALL TEN TABLES ============
alter table public.profiles       enable row level security;
alter table public.categories     enable row level security;
alter table public.listings       enable row level security;
alter table public.listing_images enable row level security;
alter table public.conversations  enable row level security;
alter table public.messages       enable row level security;
alter table public.orders         enable row level security;
alter table public.payments       enable row level security;
alter table public.payouts        enable row level security;
alter table public.reviews        enable row level security;

-- ============ TABLE & FUNCTION PRIVILEGES ============
-- This project's default privileges grant only maintenance rights
-- (TRUNCATE/REFERENCES/TRIGGER) to anon/authenticated/service_role — NOT data
-- access. Grant data privileges explicitly so PostgREST (anon/authenticated)
-- and server code (service_role) can reach the tables at all; the RLS policies
-- below then decide which rows and commands are actually permitted. Doing this
-- in the migration keeps local and hosted behaviour identical.
grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;

-- The payments audit trail is server-only: no client role may touch it. RLS
-- already denies it (zero policies); revoking the grant makes that a hard
-- permission error rather than a silently-empty result.
revoke all on table public.payments from anon, authenticated;

-- Helper functions are invoked inside the policies, so the client roles need
-- EXECUTE on them (Supabase revokes the default PUBLIC execute on functions).
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_conversation_participant(uuid) to anon, authenticated;

-- ============ PROFILES ============
-- Everyone can read profiles.
create policy profiles_select on public.profiles
  for select using (true);

-- A user may update only their own row, and may NOT change their own role.
-- The subquery returns the currently stored role, so the new role must equal
-- it. Role assignment is a server/admin concern done with the service-role key,
-- which bypasses RLS. (No insert policy: rows come from the handle_new_user
-- trigger. No delete policy: deletion cascades from auth.users.)
create policy profiles_update on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select role from public.profiles where id = auth.uid())
  );

-- ============ CATEGORIES ============
create policy categories_select on public.categories
  for select using (true);

create policy categories_insert on public.categories
  for insert to authenticated with check (public.is_admin());

create policy categories_update on public.categories
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy categories_delete on public.categories
  for delete to authenticated using (public.is_admin());

-- ============ LISTINGS ============
-- Visible when active, or to its seller, or to an admin.
create policy listings_select on public.listings
  for select using (
    status = 'active' or seller_id = auth.uid() or public.is_admin()
  );

-- Any authenticated user may create a listing they own.
create policy listings_insert on public.listings
  for insert to authenticated
  with check (seller_id = auth.uid());

create policy listings_update on public.listings
  for update to authenticated
  using (seller_id = auth.uid() or public.is_admin())
  with check (seller_id = auth.uid() or public.is_admin());

create policy listings_delete on public.listings
  for delete to authenticated
  using (seller_id = auth.uid() or public.is_admin());

-- ============ LISTING IMAGES ============
-- Readable when the parent listing is visible (active or owned), or by an admin.
create policy listing_images_select on public.listing_images
  for select using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id
        and (l.status = 'active' or l.seller_id = auth.uid())
    )
    or public.is_admin()
  );

-- Writable only by the owner of the parent listing (or an admin).
create policy listing_images_insert on public.listing_images
  for insert to authenticated
  with check (
    exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
    or public.is_admin()
  );

create policy listing_images_update on public.listing_images
  for update to authenticated
  using (
    exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
    or public.is_admin()
  )
  with check (
    exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
    or public.is_admin()
  );

create policy listing_images_delete on public.listing_images
  for delete to authenticated
  using (
    exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
    or public.is_admin()
  );

-- ============ CONVERSATIONS ============
create policy conversations_select on public.conversations
  for select using (
    public.is_conversation_participant(id) or public.is_admin()
  );

-- A buyer may start a conversation on an active listing that is not their own.
create policy conversations_insert on public.conversations
  for insert to authenticated
  with check (
    buyer_id = auth.uid()
    and exists (
      select 1 from public.listings l
      where l.id = listing_id
        and l.status = 'active'
        and l.seller_id <> auth.uid()
    )
  );

-- ============ MESSAGES ============
create policy messages_select on public.messages
  for select using (
    public.is_conversation_participant(conversation_id) or public.is_admin()
  );

create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_participant(conversation_id)
  );

-- Only the recipient (a participant who is not the sender) may update a
-- message — used to set read_at.
create policy messages_update on public.messages
  for update to authenticated
  using (
    public.is_conversation_participant(conversation_id)
    and sender_id <> auth.uid()
  );

-- ============ ORDERS ============
-- Readable by the buyer, the seller, or an admin. There are deliberately NO
-- insert/update/delete policies: order creation and every state transition
-- happen exclusively in server code with the service-role key.
create policy orders_select on public.orders
  for select using (
    buyer_id = auth.uid() or seller_id = auth.uid() or public.is_admin()
  );

-- ============ PAYMENTS ============
-- Intentionally NO policies. RLS is enabled and, with zero policies, no anon /
-- authenticated access is possible at all — the payments table (the Paystack
-- webhook audit trail) is reachable only by server code via the service-role
-- key, which bypasses RLS.

-- ============ PAYOUTS ============
-- A seller may read their own payouts; nothing else is client-accessible.
create policy payouts_select on public.payouts
  for select using (
    seller_id = auth.uid() or public.is_admin()
  );

-- ============ REVIEWS ============
create policy reviews_select on public.reviews
  for select using (true);

-- A buyer may review only their own completed order. The unique constraint on
-- reviews.order_id enforces one review per order.
create policy reviews_insert on public.reviews
  for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.buyer_id = auth.uid()
        and o.status = 'completed'
    )
  );
