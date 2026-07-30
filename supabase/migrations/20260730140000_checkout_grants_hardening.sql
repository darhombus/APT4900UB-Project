-- ============================================================================
-- CHECKOUT GRANTS HARDENING — make the privilege matrix identical on every stack
-- (Checkout PRD — Section 11 verification; rulings R-9, R-10)
--
-- 20260727170000_checkout_schema.sql GRANTed the intended privileges but never
-- REVOKEd anything, because on the LOCAL stack there was nothing to take away:
-- this project's local default privileges hand out only maintenance rights
-- (TRUNCATE/REFERENCES/TRIGGER) on a newly created table.
--
-- The HOSTED project is configured differently. It carries
--   alter default privileges in schema public
--     grant all on tables to anon, authenticated, service_role;
-- so `orders` and `payments` were born with full DML for every role, and the
-- earlier migration's grants simply added to that. Verified on the hosted
-- project after the checkout migration landed:
--
--   orders   → anon          SELECT, INSERT, UPDATE, DELETE   (intended: none)
--   orders   → authenticated SELECT, INSERT, UPDATE, DELETE   (intended: SELECT)
--   payments → anon          SELECT, INSERT, UPDATE, DELETE   (intended: none)
--   payments → authenticated SELECT, INSERT, UPDATE, DELETE   (intended: none)
--   payments → service_role  SELECT, INSERT, UPDATE, DELETE   (intended: no UPDATE)
--
-- No data was exposed — RLS held throughout (`orders` has only a SELECT policy
-- and no write policies; `payments` has RLS enabled with zero policies, so every
-- client read returns nothing). What broke is the layered guarantee:
--
--   * R-10 — service_role held UPDATE on `payments`, and service_role BYPASSES
--     RLS. The audit trail's immutability is enforced by privilege precisely so
--     that no code path can rewrite a row; on hosted it had degraded to a
--     convention. This is the material regression.
--   * R-9  — a direct client write to `orders` was an RLS zero-row no-op rather
--     than a 42501 permission error, leaving RLS as the only line of defence.
--
-- Fix: REVOKE first, then GRANT exactly what is intended. Idempotent and safe to
-- re-run, and it produces the same matrix regardless of what the environment's
-- default privileges happened to hand out.
--
-- STANDING LESSON for later phases (payouts creates `payouts` work, reviews
-- creates review tables): on this project, a new public table needs
-- REVOKE-then-GRANT, not GRANT alone. Granting alone is silently correct
-- locally and silently wrong on hosted.
-- ============================================================================

-- Strip whatever the environment's default privileges handed out. This also
-- removes the stray TRUNCATE that `authenticated` inherits project-wide — no
-- client role has any business truncating the order book.
revoke all on public.orders   from anon, authenticated, service_role;
revoke all on public.payments from anon, authenticated, service_role;

-- ---- orders (R-9) ---------------------------------------------------------
-- SELECT to authenticated and nothing else, so a direct client INSERT/UPDATE/
-- DELETE fails 42501 rather than being silently filtered to zero rows. anon
-- gets nothing at all: an anonymous read is a hard permission error.
grant select on public.orders to authenticated;
grant select, insert, update, delete on public.orders to service_role;

-- ---- payments (D9, R-10) --------------------------------------------------
-- Nothing to any client role. service_role gets SELECT/INSERT/DELETE but
-- deliberately NOT UPDATE: that absence is what makes the audit trail immutable
-- in a way no application bug or compromised server key can undo. DELETE exists
-- solely so the e2e teardown helper can clear test rows ahead of the ON DELETE
-- RESTRICT order FKs (R-5).
grant select, insert, delete on public.payments to service_role;
