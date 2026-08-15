-- ============================================================================
-- ADM SCHEMA D — listings.removed_prior_status
-- (Admin Dashboard PRD — Section 3; ruling ADM-10)
--
-- NO ENUM WIDENING, deliberately. `removed` has existed in public.listing_status
-- since the initial schema (20260710013856:7-8), reserved from the start for
-- admin moderation and held distinct from `deleted` (seller self-deletion, added
-- 20260719090000) by that migration's own header: "`deleted` is DISTINCT from
-- `removed`: `removed` stays reserved for admin moderation (different
-- provenance, different detail-page copy). The two must remain distinguishable
-- in data."
--
-- THIS PHASE DEFINES `removed`'s FIRST REAL WRITER. The Section 1 survey
-- resolved the one site that assigns the literal — messaging.ts:350 — as an
-- in-memory display fallback for a conversation whose listing row could not be
-- fetched. It never writes listings.status. Nothing in the database or the
-- application has ever set this value.
--
-- Because no ALTER TYPE ... ADD VALUE happens here, the rule that a newly added
-- enum value cannot be used in the transaction that adds it never comes into
-- play — Section 4's RPC may reference `removed` freely.
-- ============================================================================

-- Where a listing was before an admin took it down, so restore returns it to
-- exactly that state. A listing taken down while `sold` comes back `sold`, not
-- `active` — guessing a target status would silently relist sold inventory.
--
-- Typed as the enum, NOT text: restore assigns it straight back into
-- listings.status with no cast, and the column cannot hold a value that is not
-- a real status.
alter table public.listings
  add column removed_prior_status public.listing_status;

comment on column public.listings.removed_prior_status is
  'System-maintained (ADM-10). Set by admin_set_listing_visibility on takedown '
  'to the status the listing held beforehand; read and cleared on restore. '
  'NULL at every other time. No client role can write it — it is absent from '
  'the seller column allowlist and grant update (cols) never extends to '
  'columns added later.';

-- ---- Why no grant statement belongs here -----------------------------------
-- UNWRITABLE VIA UPDATE BY CONSTRUCTION, not by an explicit revoke.
--
-- `authenticated` retains column-level UPDATE on the twelve columns of the
-- boosts-phase allowlist (20260810120000:497-509) — category_id, city,
-- condition, currency, description, location_area, price, published_at,
-- quantity, status, title, type. Section 2 deliberately did not narrow that
-- set; it closed the ADM-10 hole through the listings_update row scope instead.
--
-- `grant update (cols)` enumerates columns explicitly and never extends to
-- columns added afterwards. That is precisely what the allowlist migration
-- relies on, in its own words: "a column absent from this list fails 42501 —
-- loud, and the safe direction for anything added later"
-- (20260810120000:511-514). So no client role can UPDATE this column, and a
-- REVOKE UPDATE here would be a no-op dressed up as a safeguard.
--
-- Verified at apply time and reported: removed_prior_status is absent from the
-- authenticated UPDATE allowlist, and no later migration re-grants it.
--
-- THE INSERT SIDE IS A DIFFERENT STORY, and it is NOT closed here. BST-17
-- retired the blanket UPDATE grant (rls_policies.sql:59) but left the blanket
-- INSERT from the same statement in place, so `authenticated` still holds
-- TABLE-LEVEL INSERT on listings — which, unlike a column-scoped grant, does
-- extend to every column added later, this one included. listings_insert
-- (rls_policies.sql:111-113) checks only `seller_id = auth.uid()` and
-- constrains no column.
--
-- For ADM-10 specifically this is harmless: a seller can only set the column on
-- a row they are creating, and takedown OVERWRITES the stash with the listing's
-- real prior status, so a pre-seeded value can never redirect a restore. The
-- guarantee ADM-10 needs — that a seller cannot escape or fabricate a takedown
-- on an EXISTING listing — rests on the Section 2 row scope and is unaffected.
--
-- The wider INSERT exposure it belongs to (a seller may also set boosted_until,
-- rating_sum and review_count at INSERT time, reopening BST-15/BST-16 through a
-- door those rulings did not cover) is out of this section's scope and is
-- reported for ruling rather than fixed here. Closing it means an INSERT column
-- allowlist on listings, which touches the shipped listing-creation flow.
--
-- The only writer of this column in normal operation is Section 4's
-- admin_set_listing_visibility, which is SECURITY DEFINER and runs as owner.
