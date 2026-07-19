-- ============================================================================
-- ADD `deleted` LISTING STATUS (UI refinements — Section 6, amended D1)
--
-- Ever-published listings (active / paused / sold) are SOFT-deleted by their
-- seller to a new `deleted` status (drafts keep the existing hard delete). The
-- row and its storage objects are retained so later conversations/orders can
-- still reference the listing; `deleted` hides it from every read surface.
--
-- `deleted` is DISTINCT from `removed`: `removed` stays reserved for admin
-- moderation (different provenance, different detail-page copy). The two must
-- remain distinguishable in data.
--
-- This value is added in its OWN migration: Postgres forbids using a newly-added
-- enum value in the same transaction that adds it, and the RLS policies in the
-- next migration reference `deleted`. Idempotent via IF NOT EXISTS.
-- ============================================================================

alter type public.listing_status add value if not exists 'deleted';
