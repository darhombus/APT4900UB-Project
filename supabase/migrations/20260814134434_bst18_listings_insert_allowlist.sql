-- ============================================================================
-- BST-18 — RETIRE THE BLANKET INSERT GRANT ON listings
-- (Admin Dashboard PRD — combined ruling with Sections 2 and 3)
--
-- Same originating statement as BST-17: rls_policies.sql:59 granted
-- `select, insert, update, delete` on all tables to `authenticated` in one go.
-- The Section 2 migration retired the UPDATE half. This retires the INSERT half
-- for listings, which is where it had teeth.
--
-- WHY IT HAD TEETH. A TABLE-level grant covers every column the table will ever
-- have; a COLUMN-scoped grant covers exactly what it names and never extends to
-- columns added later. The boosts and reviews phases built column allowlists for
-- UPDATE (20260810120000:495-509, 20260810140000:46-56) and deliberately
-- excluded the system-maintained aggregates — but INSERT was never narrowed, so
-- every one of those columns stayed writable on the way in.
--
-- Verified against the local stack before this migration was written: a
-- seller-role session client inserted a listing carrying
-- boosted_until = 2030-01-01, rating_sum = 4999, review_count = 999 and
-- removed_prior_status = 'active'. No error; every value persisted on a
-- service-role re-read. That is a free permanent boost outranking genuinely paid
-- ones in the search ORDER BY (20260810130000), and a fabricated five-star
-- reputation on a listing with no reviews — BST-15 and BST-16 reopened through a
-- door neither ruling covered. The recompute triggers do not save it: they fire
-- on boosts / reviews changes, so a listing that never has a boost or a review
-- keeps the forged values indefinitely.
--
-- Because a column-scoped grant does not extend to columns added later, this
-- closes the class permanently rather than the instances — completing what
-- BST-17 started. removed_prior_status (added one migration earlier) becomes
-- unwritable on INSERT as it already was on UPDATE, with no separate statement.
--
-- SURVEY, as the ruling required. Every INSERT into public.listings in the
-- shipped codebase, with the role it runs under and the columns it supplies:
--
--   src/lib/server/listings.ts:181-186   authenticated   the shipped creation
--                                                        flow — seller_id,
--                                                        category_id, type,
--                                                        title, description,
--                                                        price, condition,
--                                                        location_area, status,
--                                                        published_at
--   e2e/listings-rls.spec.ts:85,92       authenticated   category_id, type,
--                                                        description, price,
--                                                        seller_id, title,
--                                                        status
--   e2e/listings-rls.spec.ts:190         authenticated   same (buyer-role
--                                                        negative test)
--   e2e/fixtures.ts:102 (seedListing)    service_role    unaffected — line 60's
--   e2e/listings-rls.spec.ts:114,229     service_role    grant is untouched
--   e2e/checkout-rls.spec.ts:85          service_role
--   e2e/messaging-rls.spec.ts:92         service_role
--   e2e/reviews-rls.spec.ts:90           service_role
--   e2e/seller-profile.spec.ts:311       service_role
--   (no INSERT into listings exists in any migration)
--
-- The union of columns supplied anywhere under `authenticated` is ten:
-- seller_id, category_id, type, title, description, price, condition,
-- location_area, status, published_at. Every one is inside the ratified
-- allowlist, so no addition was proposed and no stop was required.
--
-- city, currency and quantity are granted without being supplied by any current
-- call site. They are kept so the INSERT and UPDATE surfaces are the same set
-- plus seller_id — one list to reason about rather than two that drift.
--
-- Load-bearing check: every NOT NULL column without a default — seller_id,
-- category_id, type, title, description, price — is in the list below. The
-- remaining NOT NULL columns (id, currency, quantity, status, created_at,
-- updated_at, city, review_count, rating_sum) all carry defaults, and a column
-- omitted from an INSERT needs no privilege for its default to apply.
--
-- NOT CHANGED HERE: `status` stays in the allowlist and BST-18 alters no
-- semantics on it. The deferred "seller arbitrary status PATCH" item is a
-- separate question about which status values a seller may write, and it is
-- untouched. listings_insert
-- (((seller_id = auth.uid()) AND is_seller_or_admin()) OR is_admin()) is
-- likewise untouched: a buyer-role user is still refused by policy, exactly as
-- before, and for the same reason.
-- ============================================================================

-- REVOKE first. Revoking the table-level privilege also clears every
-- column-level privilege it implied, so the GRANT below is the whole of what
-- `authenticated` may write on INSERT afterwards — never an addition to an
-- unknown prior state (standing pattern; hosted-vs-local lesson at
-- 20260730140000:39-45).
revoke insert on public.listings from authenticated;

grant insert (
  category_id,
  city,
  condition,
  currency,
  description,
  location_area,
  price,
  published_at,
  quantity,
  seller_id,
  status,
  title,
  type
) on public.listings to authenticated;

-- WHAT IS DELIBERATELY ABSENT, AND WHY:
--
--   boosted_until           derived from the boosts ledger by
--                           boosts_sync_listing_boosted_until()
--                           (20260810120000:243-268). Excluded from the UPDATE
--                           allowlist for this reason; excluded here for the
--                           same one.
--   review_count            maintained by the reviews phase's SECURITY DEFINER
--   rating_sum              trigger. These were the BST-16 exposure on UPDATE;
--                           this closes the INSERT path to the same forgery.
--   removed_prior_status    system-maintained (ADM-10). Written only by
--                           admin_set_listing_visibility in Section 4.
--   search_vector           maintained by the full-text trigger.
--   id, created_at,         identity and historical fact; defaults apply.
--   updated_at
