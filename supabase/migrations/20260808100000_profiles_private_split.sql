-- ============================================================================
-- PROFILES PII HARDENING — move phone/location into their own table
-- (PII PRD — Section 2; decisions D1–D6, rulings PII-2, PII-3, PII-5)
--
-- `profiles_select using (true)` lets anon read every column of `public.profiles`
-- through PostgREST, `phone` included. The seller-profile phase closed what the
-- PAGE ships (SP-16) and recorded explicitly that this was presentation-layer
-- discipline, not a boundary — the row was still readable directly. This
-- migration makes column exposure a database decision instead.
--
-- Mechanism is a table split rather than column-privilege revocation (D1): RLS is
-- shaped for row scoping, so the private table gets a policy it can actually
-- enforce, and every public read/embed of `profiles` keeps working untouched
-- rather than turning into a latent 42501 on an implicit select.
--
-- Order matters and is fixed by D6: create, backfill, recreate dependents, THEN
-- drop. The backfill travels with the schema change (the reviews standing
-- pattern) because the private table gets exactly one chance to start complete.
-- ============================================================================

-- ---- 1. The table (D3, amended PII-3 / PII-5) -----------------------------
create table public.profiles_private (
  id         uuid primary key references public.profiles (id) on delete cascade,
  -- Constraints, not just the type. `profiles.phone` carried a column-level
  -- UNIQUE and this CHECK; dropping the column drops both, and `uniquePhone()`
  -- in the e2e fixtures generates non-colliding numbers precisely to avoid the
  -- constraint — so losing it would not have failed a single test. One account
  -- per number is a product guarantee, and it is restated here deliberately.
  phone      text unique check (phone ~ '^\+254[17]\d{8}$'),
  -- Plain text, as it was: `profiles.location` carried no CHECK and no UNIQUE.
  location   text,
  updated_at timestamptz not null default now()
);

comment on table public.profiles_private is
  'Private profile columns, split out of public.profiles (PII PRD D1). One row '
  'per profile that HAS private data — absence of a row is a valid state (D3), '
  'not a missing row to be repaired. anon holds no privilege here at all, so an '
  'anon read is 42501 rather than an empty result that would hide a bug (D5).';

comment on column public.profiles_private.phone is
  'Kenyan MSISDN. UNIQUE and format-checked exactly as profiles.phone was — see '
  'the constraint comment above for why that is restated rather than assumed.';

-- `updated_at` is maintained the same way profiles maintains its own (PII-5).
-- Without the trigger the column is `default now()` and then permanently stale,
-- which is worse than not having the column.
create trigger profiles_private_updated_at
  before update on public.profiles_private
  for each row execute function public.set_updated_at();

-- ---- 2. Backfill, BEFORE the drops (D6) -----------------------------------
-- Only rows that actually hold something: absence of a row is the valid
-- representation of "no phone on file", so inserting empty rows would encode a
-- state D3 says should not exist.
--
-- The new UNIQUE cannot fail here: every value comes from profiles.phone, which
-- carried its own UNIQUE, so the source set is already distinct.
insert into public.profiles_private (id, phone, location)
select id, phone, location
  from public.profiles
 where phone is not null
    or location is not null;

-- ---- 3. Recreate the one dependent object (PII-2) -------------------------
-- handle_new_user() is the ONLY database object referencing either column —
-- verified across every migration: no view, no generated column, no other
-- function, and no RLS policy reads phone or location. It is recreated here as a
-- new definition rather than edited in place, per the never-touch-an-applied-
-- migration rule.
--
-- It stays SECURITY DEFINER, which is what lets it write both tables during user
-- creation: the row does not belong to anyone who is authenticated yet, so the
-- own-row policies below cannot carry this write.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_phone text;
begin
  v_phone := nullif(new.raw_user_meta_data ->> 'phone', '');

  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', 'New User')
  );

  -- Only when there is something to store (D3). A signup without a phone leaves
  -- no private row, which is the state the account settings upsert later fills.
  if v_phone is not null then
    insert into public.profiles_private (id, phone)
    values (new.id, v_phone);
  end if;

  return new;
end $$;

-- Function grant hardening, same shape as the checkout function hardening: this
-- runs as its owner, so EXECUTE is not something client roles should hold. The
-- trigger invokes it internally and needs no grant at all.
revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;

-- ---- 4. Drop the columns (D6) ---------------------------------------------
alter table public.profiles
  drop column phone,
  drop column location;

-- ---- 5. RLS (D4) ----------------------------------------------------------
alter table public.profiles_private enable row level security;
-- FORCE is currently inert on this project: both `postgres` (the table owner,
-- and therefore the owner of every SECURITY DEFINER function above) and
-- `service_role` carry the BYPASSRLS role attribute, which outranks FORCE. It is
-- set anyway so the table's own definition states the intent, and so the
-- guarantee survives an owner that later loses BYPASSRLS. Belt-and-braces
-- against role-attribute divergence between the local and hosted stacks — the
-- same class of local/hosted drift that the checkout grants hardening existed to
-- close; verified inert on local (postgres and service_role hold BYPASSRLS) as
-- of this migration.
alter table public.profiles_private force row level security;

-- Own row only, and no anon policy of any kind. There is deliberately no SELECT
-- policy for anon rather than a restrictive one: combined with the absent grant
-- below, an anon attempt fails on privilege before RLS is ever consulted.
create policy profiles_private_select on public.profiles_private
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_private_insert on public.profiles_private
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy profiles_private_update on public.profiles_private
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---- 6. Grants (D5) -------------------------------------------------------
-- STANDING LESSON (checkout grants hardening, 20260730140000): on this project a
-- new public table needs REVOKE-then-GRANT, not GRANT alone. The hosted project
-- carries `alter default privileges ... grant all on tables to anon,
-- authenticated, service_role`, so a new table is born with full DML for every
-- role and granting alone is silently correct locally and silently wrong hosted.
revoke all on public.profiles_private from anon, authenticated, service_role;

-- RLS scopes the rows; the grant scopes the verbs. No DELETE: clearing a phone
-- is an UPDATE to null, and row removal belongs to the cascade from profiles.
grant select, insert, update on public.profiles_private to authenticated;
grant all on public.profiles_private to service_role;
-- anon: nothing, deliberately. Not even SELECT — the failure mode for any anon
-- path must be 42501, not an empty result that looks like "no data" and hides a
-- bug for a release or two.
