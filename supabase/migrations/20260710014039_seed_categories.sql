-- Seed the four top-level categories with fixed slugs. Run as a migration so
-- every environment (local, hosted) shares the same base taxonomy. Idempotent:
-- re-applying does nothing thanks to the unique slug + on conflict clause.
insert into public.categories (name, slug) values
  ('Consumer Electronics', 'consumer-electronics'),
  ('Clothing', 'clothing'),
  ('Household Goods', 'household-goods'),
  ('Small Services', 'small-services')
on conflict (slug) do nothing;
