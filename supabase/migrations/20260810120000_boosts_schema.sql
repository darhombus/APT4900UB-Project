-- ============================================================================
-- BOOSTS SCHEMA — boost_packages, the boosts ledger, and listings.boosted_until
-- (Boosts PRD — Section 2; decisions BST-3, BST-4, BST-5, BST-9, BST-10,
--  BST-11, BST-12 as amended, BST-13)
--
-- Three objects and one column:
--   * boost_packages   — the three purchasable tiers, priced in the table (BST-3)
--   * boosts           — the purchase ledger; immutable beyond status (BST-12)
--   * transition_boost_status — the ONLY write path to boosts.status
--   * listings.boosted_until  — the derived effective boost window, recomputed
--                               from the ledger by trigger (BST-12 as amended)
--
-- WHY boosted_until LIVES ON listings AND NOT IN A SIDE TABLE
--
-- `search_listings` is `returns setof public.listings` and projects `(c.rec).*`
-- rather than enumerating columns — deliberately, so that a later migration
-- adding a column cannot break its return shape (DEVLOG:2699). A column on
-- listings therefore reaches the ranking expression, the search executor and
-- every card consumer with no function signature change and no extra query,
-- exactly as review_count/rating_sum did in the reviews phase. That is why
-- Section 5.3's separate `is_featured` field was dropped: boosted_until IS the
-- surfaced field.
--
-- THE PRIVILEGE CONSEQUENCE OF THAT CHOICE — read section 8 before this file is
-- applied. Putting the column on listings puts it inside the blanket
-- `grant ... update ... to authenticated` from 20260710015112_rls_policies.sql:59,
-- under a listings_update policy that permits a seller to update their own row.
-- Left alone, every seller could grant themselves an unlimited free boost with
-- one PostgREST call. Section 8 closes that, and it is not optional.
-- ============================================================================


-- ---- 1. BOOST_PACKAGES — the purchasable tiers (BST-3) ---------------------
-- Prices live here, not in code, so a price change is a data change. Each
-- purchase snapshots what it was actually charged (section 2), the same
-- principle by which an order snapshots the listing price rather than joining
-- to it.
create table public.boost_packages (
  id            uuid primary key default gen_random_uuid(),
  duration_days integer not null check (duration_days > 0),
  price_kes     integer not null check (price_kes > 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.boost_packages is
  'Purchasable boost tiers (BST-3). Prices live in the table, not in code. '
  'Retire a tier by setting active = false and inserting its replacement — '
  'never by editing a row a boosts.price_kes_charged snapshot refers to.';
comment on column public.boost_packages.price_kes is
  'WHOLE SHILLINGS, not cents. This is the ONE place in the schema where money '
  'is not integer minor units (orders.amount_total, payouts.amount_kes_cents and '
  'every other money column are bigint KES cents, D8). Section 2.1 of the PRD '
  'specifies whole shillings and BST-3 specifies that Paystack receives KES*100, '
  'so the conversion happens exactly once, at the initializeTransaction call in '
  'the Section 3 purchase route, and the verified-amount comparison must convert '
  'the same way. Nowhere else may multiply or divide this value.';
comment on column public.boost_packages.active is
  'Readable by authenticated only where true (RLS, section 7). An inactive tier '
  'stays for the FK from historical boosts rows.';

-- One live tier per duration. This is what makes "retire and replace" the only
-- way to change a price: a second active 7-day tier is refused by the index
-- rather than by a convention someone has to remember. Partial, so retired tiers
-- accumulate freely.
create unique index boost_packages_active_duration_key
  on public.boost_packages (duration_days)
  where active;

-- Seed travels with the schema (standing rule). Three tiers, BST-3 exactly.
insert into public.boost_packages (duration_days, price_kes) values
  ( 7, 200),
  (14, 350),
  (30, 650);


-- ---- 2. BOOSTS — the purchase ledger --------------------------------------
-- Immutable beyond status, enforced by PRIVILEGE rather than by trigger (the
-- R-10 / payouts pattern): no role holds UPDATE, including service_role, so the
-- only write path to `status` is transition_boost_status in section 6.
create table public.boosts (
  id                 uuid primary key default gen_random_uuid(),
  listing_id         uuid not null references public.listings (id) on delete restrict,
  seller_id          uuid not null references public.profiles (id) on delete restrict,
  package_id         uuid not null references public.boost_packages (id) on delete restrict,
  price_kes_charged  integer not null check (price_kes_charged > 0),
  duration_days      integer not null check (duration_days > 0),
  paystack_reference text not null,
  status             text not null default 'pending'
                       check (status in ('pending', 'active', 'expired', 'failed')),
  starts_at          timestamptz,
  expires_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- BST-14 — the reference namespace is the webhook's routing discriminator, so
  -- it is a data-layer guarantee and not a convention. A boosts row can never
  -- carry an `msk_` checkout reference, which is BST-11's structural segregation
  -- expressed in the one place both flows meet. (`\_` is an escaped underscore:
  -- LIKE's default escape is the backslash.)
  constraint boosts_reference_namespaced check (paystack_reference like 'boost\_%'),

  -- A window is set atomically at activation or not at all. Guards against a
  -- half-populated row that the expiry job would then have to interpret.
  constraint boosts_window_complete check (
    (starts_at is null and expires_at is null)
    or (starts_at is not null and expires_at is not null and expires_at > starts_at)
  )
);

comment on table public.boosts is
  'Paid listing boost purchases (BST-2). Platform revenue: these rows are NOT '
  'orders and never become any seller''s earnings — see the segregation note on '
  'price_kes_charged. Immutable beyond status; no role holds UPDATE, so '
  'transition_boost_status is the sole write path (BST-12 as amended).';
comment on column public.boosts.price_kes_charged is
  'Whole shillings, snapshotted from boost_packages.price_kes at purchase (BST-3). '
  'BST-11 SEGREGATION: this is platform revenue and must never reach the payout '
  'ledger. That holds structurally rather than by a filter — payouts derive '
  'exclusively from orders.seller_net on completed orders '
  '(seller_available_balance), and the boost flow creates no orders row. The '
  'invariant to protect is therefore "a boost purchase writes nothing to orders", '
  'which is what the Section 7 segregation test asserts.';
comment on column public.boosts.duration_days is
  'Snapshotted alongside the price, so activation is self-contained: '
  'transition_boost_status computes the window without joining to a package that '
  'may since have been retired.';
comment on column public.boosts.paystack_reference is
  'Our reference, `boost_<uuid>`, generated before Paystack sees the transaction '
  '(the D10 pattern, namespaced per BST-14). Unique, so a duplicate webhook or a '
  'webhook racing the callback resolves to the same row.';
comment on column public.boosts.expires_at is
  'Set once at activation with BST-5 extension semantics and never edited after. '
  'An extension does not move this value — it creates a NEW row carrying the '
  'extended window and supersedes this one. That is what lets each expiry job own '
  'exactly one immutable target.';
comment on column public.boosts.updated_at is
  'Maintained by transition_boost_status, NOT by a trigger — the payouts '
  'precedent. No role holds UPDATE, so the sole writer sets this column itself.';

-- The idempotency key (BST-14, D10 pattern).
create unique index boosts_reference_key
  on public.boosts (paystack_reference);

-- BST-5 — "at most one effective boost window per listing", as a guarantee
-- rather than as application logic. The extension path in section 6 supersedes
-- the incumbent in the same transaction that activates its replacement; if two
-- activations for one listing ever race past that, the second gets 23505 instead
-- of silently stacking. Mirrors payouts_one_in_flight_per_seller.
create unique index boosts_one_active_per_listing
  on public.boosts (listing_id)
  where status = 'active';

create index boosts_seller_idx  on public.boosts (seller_id, created_at desc);
create index boosts_listing_idx on public.boosts (listing_id, created_at desc);


-- ---- 3. listings.boosted_until — the derived effective window --------------
alter table public.listings
  add column boosted_until timestamptz;

comment on column public.listings.boosted_until is
  'Effective boost expiry, DERIVED from the boosts ledger by trigger (section 5) '
  'and never written by hand. NULL means not boosted. The ranking term reads '
  '`boosted_until > now()`, which is what makes elevation self-expiring: a lost '
  'or delayed expiry job cannot leave a listing permanently boosted (BST-9), '
  'because the predicate stops being true at the appointed moment whether or not '
  'any job ran. The job only tidies boosts.status.';

-- Supports finding currently-boosted listings cheaply (an admin surface later,
-- and the seller''s own "is this live?" read today). Stated honestly: it does NOT
-- accelerate the ORDER BY term added in Section 5 — that sorts on a boolean
-- expression over a union of CTEs and will not use this index. Partial, so it
-- stays small: only boosted rows are in it.
create index listings_boosted_until_idx
  on public.listings (boosted_until desc)
  where boosted_until is not null;


-- ---- 4. Purchase-time eligibility, at the data layer (BST-4) ---------------
-- BST-4 is validated in the Section 3 route so a buyer gets a friendly error.
-- This is the guarantee behind that check, and it exists for the same reason the
-- reviews phase added reviews_verify_denormalization: seller_id is DENORMALIZED
-- onto the ledger row, and a denormalization that can disagree with its source
-- is a bug waiting for a caller to make it. A boosts row attributed to the wrong
-- seller would be readable by the wrong seller under the RLS policy in section 7.
--
-- SECURITY DEFINER so the listing lookup is not RLS-filtered: `not found` here
-- must mean the listing does not exist, never that the caller could not see it.
--
-- The `role = 'seller'` half of BST-4 is deliberately NOT here. It is a fact
-- about the caller, not about the row, and it belongs with the other caller
-- checks in the Section 3 route; encoding it here would also make it impossible
-- to write a fixture for a demoted seller''s historical boost.
create or replace function public.boosts_verify_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.listings;
begin
  select * into v_listing from public.listings where id = new.listing_id;

  if not found then
    raise exception 'boosts: listing % does not exist', new.listing_id
      using errcode = 'P0001';
  end if;

  if new.seller_id is distinct from v_listing.seller_id then
    raise exception 'boosts: seller % does not own listing %',
      new.seller_id, new.listing_id
      using errcode = 'P0001';
  end if;

  -- BST-4 — active at PURCHASE time. Not re-checked at activation: BST-10 makes
  -- a listing that dies mid-boost inert rather than special, and the listing has
  -- already dropped out of every result set by then.
  if v_listing.status <> 'active' then
    raise exception 'boosts: listing % is not active (status %)',
      new.listing_id, v_listing.status
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists boosts_verify_eligibility on public.boosts;
create trigger boosts_verify_eligibility
  before insert on public.boosts
  for each row execute function public.boosts_verify_eligibility();


-- ---- 5. boosted_until maintenance — RECOMPUTE, not delta (BST-12) ----------
-- The reviews phase maintains its aggregates by delta because a running sum has
-- no cheap recomputation. This one recomputes from the ledger on every touch,
-- which is the amended BST-12's explicit instruction and the better fit: the
-- value is a single MAX over at most one row, so recomputation costs nothing and
-- is idempotent by construction. A trigger that cannot drift needs no reconciler.
create or replace function public.boosts_sync_listing_boosted_until()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing_id uuid;
  v_effective  timestamptz;
begin
  v_listing_id := coalesce(new.listing_id, old.listing_id);

  -- MAX over the active set. boosts_one_active_per_listing caps that set at one
  -- row, so this is a max over zero or one value; written as an aggregate anyway
  -- because the NULL it returns for an empty set is exactly the "not boosted"
  -- state, with no branch needed to clear the column.
  select max(b.expires_at) into v_effective
    from public.boosts b
   where b.listing_id = v_listing_id
     and b.status = 'active';

  -- `is distinct from` so an unchanged value writes nothing. Without it every
  -- pending-row insert would rewrite listings and fire listings_updated_at,
  -- bumping updated_at on a listing whose boost has not started.
  update public.listings l
     set boosted_until = v_effective
   where l.id = v_listing_id
     and l.boosted_until is distinct from v_effective;

  return coalesce(new, old);
end;
$$;

-- Fires on the ledger operations that can change the active set. `update of
-- status, expires_at` rather than a bare `update` for the same reason as the
-- guard above: nothing else on the row can move this value.
drop trigger if exists boosts_sync_listing_boosted_until on public.boosts;
create trigger boosts_sync_listing_boosted_until
  after insert or update of status, expires_at or delete on public.boosts
  for each row execute function public.boosts_sync_listing_boosted_until();


-- ---- 6. The only write path to boosts.status (BST-12 as amended) ----------
-- SECURITY DEFINER because NO role holds UPDATE on public.boosts — not even
-- service_role. That absence is the immutability guarantee; this function, owned
-- by postgres, is its single deliberate exception. Directly mirrors
-- transition_payout_status (20260731110000_payout_balance_functions.sql:106).
--
-- THE GRAPH (BST-12 as amended):
--   pending → active    payment verified; computes the window (BST-5)
--   pending → failed    payment failed; no listing state changes
--   active  → expired   the window closed, or a newer purchase superseded it
--
-- Everything else raises. Sections 3 and 4 rely on that: they catch the
-- exception and treat it as the no-op it is, which is what makes a duplicate
-- webhook, a replayed callback and a superseded expiry job all safe at the DATA
-- layer rather than in whichever caller happened to arrive first.
create or replace function public.transition_boost_status(
  p_boost_id   uuid,
  p_new_status text
)
returns public.boosts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_boost     public.boosts;
  v_from      text;
  v_incumbent timestamptz;
begin
  select * into v_boost
    from public.boosts
   where id = p_boost_id
     for update;

  if not found then
    raise exception 'boost_not_found' using errcode = 'P0002';
  end if;

  v_from := v_boost.status;

  if not (
       (v_from = 'pending' and p_new_status = 'active')
    or (v_from = 'pending' and p_new_status = 'failed')
    or (v_from = 'active'  and p_new_status = 'expired')
  ) then
    raise exception 'invalid_boost_transition: % -> %', v_from, p_new_status
      using errcode = 'P0001';
  end if;

  if p_new_status = 'active' then
    -- BST-5 — extension, not stacking. The incumbent's remaining time is carried
    -- forward into THIS row's window; the incumbent is then superseded, so the
    -- listing is left with exactly one active boost whose expires_at is the
    -- extended one. Read from the LEDGER, not from listings.boosted_until: the
    -- ledger is the source of truth and this must not depend on the section 5
    -- trigger having already run.
    select max(b.expires_at) into v_incumbent
      from public.boosts b
     where b.listing_id = v_boost.listing_id
       and b.status = 'active';

    -- Supersede first, so boosts_one_active_per_listing is satisfiable when this
    -- row goes active a statement later. The superseded row's own expiry job
    -- will later find it already 'expired' and be refused by the graph above —
    -- that refusal IS the BST-9 "superseded job no-ops" requirement, enforced
    -- here rather than by the job re-reading state and deciding for itself.
    update public.boosts
       set status     = 'expired',
           updated_at = now()
     where listing_id = v_boost.listing_id
       and status     = 'active';

    -- GREATEST(now, incumbent expiry) + duration, per Section 2.4. The greatest()
    -- matters when the incumbent is already past its expiry but its job has not
    -- run: the new window starts now rather than being back-dated into a window
    -- the buyer never received.
    update public.boosts
       set status     = 'active',
           starts_at  = now(),
           expires_at = greatest(now(), coalesce(v_incumbent, now()))
                        + make_interval(days => v_boost.duration_days),
           updated_at = now()
     where id = p_boost_id
    returning * into v_boost;

  elsif p_new_status = 'expired' then
    -- BST-9's other half: "never PREMATURELY un-boosted". A superseded job is
    -- already refused by the graph, so the only way to reach here early is a bug
    -- or a hand-run call — but the cost of one is a seller silently losing paid
    -- placement, so it is refused too.
    --
    -- The one-minute tolerance is deliberate and is not slop: step.sleepUntil can
    -- fire a moment early and the app server's clock is not the database's. A
    -- zero-tolerance comparison would convert ordinary scheduler jitter into a
    -- permanently stuck 'active' row, since the job has already had its turn.
    if v_boost.expires_at is not null
       and v_boost.expires_at > now() + interval '1 minute' then
      raise exception 'boost_not_yet_expired: % expires at %',
        p_boost_id, v_boost.expires_at
        using errcode = 'P0001';
    end if;

    update public.boosts
       set status     = 'expired',
           updated_at = now()
     where id = p_boost_id
    returning * into v_boost;

  else  -- 'failed'
    -- No listing state changes on a failed charge: the row never went active, so
    -- the section 5 trigger recomputes the same value and writes nothing.
    update public.boosts
       set status     = 'failed',
           updated_at = now()
     where id = p_boost_id
    returning * into v_boost;
  end if;

  return v_boost;
end;
$$;

comment on function public.transition_boost_status(uuid, text) is
  'The ONLY write path to boosts.status (BST-12 as amended). Enforces '
  'pending→active|failed and active→expired; anything else raises P0001, which '
  'is how duplicate webhooks and superseded expiry jobs become no-ops. '
  'Activation computes the BST-5 extension window and supersedes the incumbent. '
  'SECURITY DEFINER because no role — including service_role — holds UPDATE on '
  'boosts.';


-- ---- 7. RLS ---------------------------------------------------------------
-- FORCE, following reviews and profiles_private: without it the table owner
-- (postgres, and therefore anything running as the owner) bypasses these
-- policies, which would make the own-rows scope weaker than it reads.
alter table public.boosts         enable row level security;
alter table public.boosts         force  row level security;
alter table public.boost_packages enable row level security;
alter table public.boost_packages force  row level security;

-- A seller reads their own purchases and nothing else (BST-12). Reachable and
-- load-bearing precisely because `authenticated` holds SELECT in section 8 —
-- GRANT and RLS are independent gates and the GRANT is checked first.
--
-- No `or public.is_admin()` here, unlike payouts_select. BST-12 as amended says
-- own rows, and Section 6.3 defers every admin boost surface to the admin
-- dashboard phase; an admin read with no reader is scope this phase does not
-- need. Add it with the surface that uses it.
create policy boosts_select on public.boosts
  for select using (seller_id = auth.uid());

-- The package picker reads the live tiers. Retired tiers stay invisible to
-- clients while remaining available to the FK and to service_role.
create policy boost_packages_select on public.boost_packages
  for select using (active);

-- No INSERT/UPDATE/DELETE policies on either table, deliberately. Writes are
-- service-role only, and service_role bypasses RLS — for it, the grants below
-- are the ONLY control.


-- ---- 8. Grants (BST-12) ---------------------------------------------------
-- STANDING LESSON (checkout grants hardening, 20260730140000): on this project a
-- new table is NOT born private. The hosted database carries
-- `alter default privileges ... grant all on tables to anon, authenticated,
-- service_role`, so a fresh table arrives with full DML for every role and
-- granting alone is silently correct locally and silently wrong hosted. REVOKE
-- first, every time.
revoke all on public.boosts         from anon, authenticated, service_role;
revoke all on public.boost_packages from anon, authenticated, service_role;

-- Sellers read; that is the whole client surface. No INSERT/UPDATE/DELETE to any
-- client role, so a direct client write fails 42501 rather than being silently
-- filtered to zero rows — the distinction the Section 7 tests assert.
grant select on public.boosts         to authenticated;
grant select on public.boost_packages to authenticated;

-- anon gets nothing on either table. An anonymous probe is a hard permission
-- error (42501), not an empty result.

-- service_role: no UPDATE on boosts. That absence is the immutability guarantee
-- (section 6). DELETE exists for the same narrow reason it does on payouts — the
-- e2e teardown helper must be able to clear test rows ahead of the ON DELETE
-- RESTRICT FKs to listings and profiles.
grant select, insert, delete on public.boosts to service_role;

-- boost_packages is configuration, not a ledger: UPDATE is how a tier is
-- retired (active = false) so its replacement can be inserted.
grant select, insert, update, delete on public.boost_packages to service_role;


-- ---- 8b. Closing the self-boost hole on listings --------------------------
-- MANDATORY, not hardening. 20260710015112_rls_policies.sql:59 grants
-- table-level UPDATE on every public table to `authenticated`, and
-- listings_update (same file, :115) permits a seller to update their own row.
-- Table-level UPDATE covers EVERY column, including ones added years later. So
-- the moment boosted_until exists on listings, this is a valid request from any
-- authenticated seller against their own listing:
--
--     patch /rest/v1/listings?id=eq.<own-listing>
--     { "boosted_until": "2099-01-01T00:00:00Z" }
--
-- — an unlimited free boost, self-served, bypassing Paystack entirely. No RLS
-- policy stops it: the row IS theirs. The paid-boost model does not survive
-- shipping section 3 without this block.
--
-- The fix is the project's standing preference for privilege over trigger:
-- replace the table-wide UPDATE with a column-scoped one that enumerates what a
-- seller may actually write. A column absent from this list fails 42501 — loud,
-- and the safe direction for anything added later.
revoke update on public.listings from authenticated;

grant update (
  category_id,
  city,
  condition,
  currency,
  description,
  location_area,
  price,
  published_at,
  quantity,
  status,
  title,
  type
) on public.listings to authenticated;

-- WHAT IS DELIBERATELY ABSENT, AND WHY:
--
--   boosted_until               this phase; derived from the ledger (section 5)
--   review_count, rating_sum    PRE-EXISTING HOLE, closed here in passing. These
--                               arrived on listings in the reviews phase under
--                               the same blanket grant, so a seller could write
--                               their own aggregates and inflate the dampened
--                               rating term in the search ORDER BY. Nothing in
--                               the app writes them from a session client — the
--                               reviews trigger is SECURITY DEFINER and the e2e
--                               specs only read them — so excluding them costs
--                               nothing and leaving them in would be knowingly
--                               preserving a hole while touching this exact line.
--                               The identical hole on profiles.review_count /
--                               rating_sum is NOT addressed here: it is a
--                               different table and a different concern, and it
--                               is reported separately for its own ruling.
--   id, seller_id, created_at   identity and ownership; a seller reassigning
--                               seller_id could hand a listing to a stranger
--   updated_at                  set by the listings_updated_at BEFORE trigger.
--                               Column privileges are checked against the
--                               statement's target list, not against what a
--                               trigger assigns, so the trigger keeps working
--                               without the grant.
--   search_vector               generated; never updatable by anyone
--
-- service_role keeps table-level UPDATE untouched: finalize_order_payment's
-- `status = 'sold'` (20260727170000_checkout_schema.sql:321), the e2e fixtures'
-- admin client, and the section 5 trigger all continue to work unchanged.
-- `anon` never held UPDATE at all (:58 grants it SELECT only).


-- ---- 9. Function grants ---------------------------------------------------
-- REVOKE first: Postgres grants EXECUTE to PUBLIC by default, so granting alone
-- leaves that default in place. Follows 20260731110000:164-180.
revoke execute on function public.transition_boost_status(uuid, text)
  from public, anon, authenticated;

-- service_role ONLY. A seller must never be able to activate their own boost —
-- that is the entire payment gate.
grant execute on function public.transition_boost_status(uuid, text)
  to service_role;

-- The trigger functions need no grant from anyone: a trigger invokes its
-- function internally, as the owner. Revoked from every role so an unexpected
-- direct call is a permission error rather than a surprise. Mirrors
-- 20260808100000_profiles_private_split.sql:102.
revoke all on function public.boosts_verify_eligibility()
  from public, anon, authenticated, service_role;
revoke all on function public.boosts_sync_listing_boosted_until()
  from public, anon, authenticated, service_role;
