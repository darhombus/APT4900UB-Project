-- ============================================================================
-- COMPLETE CATEGORY TAXONOMY (Listings PRD — Section 4)
--
-- Additive, idempotent migration. The setup-phase schema
-- (20260710013856_initial_schema.sql) already ships the hierarchy pieces the PRD
-- asks for, so this file does NOT recreate them:
--   - public.categories(parent_id) self-referencing FK (null for top-level)
--   - public.categories(slug) UNIQUE NOT NULL
--   - the four top-level rows are seeded by 20260710014039_seed_categories.sql
--     with fixed slugs (consumer-electronics, clothing, household-goods,
--     small-services)
--
-- RLS is likewise already correct from 20260710015112_rls_policies.sql:
--   categories_select USING (true)  -> public (anon + authenticated) read
--   categories_insert/update/delete -> gated on public.is_admin()
-- So categories are public-read, admin-managed, with no user-facing CRUD, and the
-- service role bypasses RLS for server jobs. No policy changes needed here.
--
-- What this migration adds: a display-order column and one level of
-- subcategories (two levels total), seeded idempotently.
-- ============================================================================

-- Display order. NOT NULL DEFAULT 0 so existing rows get a value immediately;
-- backfilled below for the four top-level categories.
alter table public.categories
  add column if not exists sort_order integer not null default 0;

-- Backfill sort_order for the existing top-level categories. Idempotent: keyed by
-- the fixed slugs, updates in place, never re-inserts.
update public.categories set sort_order = 1 where slug = 'consumer-electronics';
update public.categories set sort_order = 2 where slug = 'clothing';
update public.categories set sort_order = 3 where slug = 'household-goods';
update public.categories set sort_order = 4 where slug = 'small-services';

-- Seed the 24 subcategories (6 per top-level). Each row resolves its parent by the
-- top-level slug via the JOIN, so this is order-independent and safe to re-run:
-- ON CONFLICT (slug) DO NOTHING makes re-application a no-op.
insert into public.categories (name, slug, parent_id, sort_order)
select v.name, v.slug, parent.id, v.sort_order
from (
  values
    -- Consumer Electronics
    ('Phones & Tablets',        'phones-tablets',        'consumer-electronics', 1),
    ('Computers & Laptops',     'computers-laptops',     'consumer-electronics', 2),
    ('TVs & Audio',             'tvs-audio',             'consumer-electronics', 3),
    ('Cameras',                 'cameras',               'consumer-electronics', 4),
    ('Accessories & Wearables', 'accessories-wearables', 'consumer-electronics', 5),
    ('Other Electronics',       'other-electronics',     'consumer-electronics', 6),
    -- Clothing
    ('Men''s Clothing',         'mens-clothing',         'clothing',             1),
    ('Women''s Clothing',       'womens-clothing',       'clothing',             2),
    ('Kids & Baby',             'kids-baby',             'clothing',             3),
    ('Shoes',                   'shoes',                 'clothing',             4),
    ('Bags & Accessories',      'bags-accessories',      'clothing',             5),
    ('Other Clothing',          'other-clothing',        'clothing',             6),
    -- Household Goods
    ('Furniture',               'furniture',             'household-goods',      1),
    ('Kitchen & Dining',        'kitchen-dining',        'household-goods',      2),
    ('Home Appliances',         'home-appliances',       'household-goods',      3),
    ('Bedding & Decor',         'bedding-decor',         'household-goods',      4),
    ('Garden & Outdoor',        'garden-outdoor',        'household-goods',      5),
    ('Other Household',         'other-household',       'household-goods',      6),
    -- Small Services
    ('Repairs & Maintenance',   'repairs-maintenance',   'small-services',       1),
    ('Cleaning',                'cleaning',              'small-services',       2),
    ('Beauty & Wellness',       'beauty-wellness',       'small-services',       3),
    ('Tutoring & Lessons',      'tutoring-lessons',      'small-services',       4),
    ('Events & Catering',       'events-catering',       'small-services',       5),
    ('Other Services',          'other-services',        'small-services',       6)
) as v(name, slug, parent_slug, sort_order)
join public.categories parent on parent.slug = v.parent_slug
on conflict (slug) do nothing;
