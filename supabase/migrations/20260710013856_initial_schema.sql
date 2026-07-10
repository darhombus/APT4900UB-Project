-- ============ EXTENSIONS ============
create extension if not exists pg_trgm;

-- ============ ENUMS ============
create type public.user_role as enum ('buyer', 'seller', 'admin');
create type public.listing_type as enum ('product', 'service');
create type public.listing_status as enum
  ('draft', 'active', 'paused', 'sold', 'removed');
create type public.item_condition as enum
  ('new', 'used_like_new', 'used_good', 'used_fair');
create type public.order_status as enum
  ('pending_payment', 'paid', 'fulfilled', 'completed',
   'cancelled', 'disputed', 'refunded');
create type public.payment_method as enum ('mpesa', 'card');
create type public.payment_status as enum
  ('initiated', 'processing', 'succeeded', 'failed');
create type public.payout_status as enum
  ('pending', 'processing', 'paid', 'failed');

-- ============ UPDATED_AT TRIGGER FUNCTION ============
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ============ PROFILES ============
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null check (char_length(full_name) between 2 and 120),
  phone       text unique check (phone ~ '^\+254[17]\d{8}$'),
  avatar_url  text,
  role        public.user_role not null default 'buyer',
  location    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row when a user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', 'New User'),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ CATEGORIES ============
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  parent_id  uuid references public.categories (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ============ LISTINGS ============
create table public.listings (
  id           uuid primary key default gen_random_uuid(),
  seller_id    uuid not null references public.profiles (id) on delete cascade,
  category_id  uuid not null references public.categories (id) on delete restrict,
  type         public.listing_type not null,
  title        text not null check (char_length(title) between 3 and 120),
  description  text not null check (char_length(description) <= 5000),
  condition    public.item_condition,
  price        numeric(12,2) not null check (price > 0),
  currency     text not null default 'KES',
  quantity     integer not null default 1 check (quantity >= 0),
  status       public.listing_status not null default 'draft',
  location     text,
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint condition_products_only
    check (type = 'product' or condition is null)
);
create trigger listings_updated_at before update on public.listings
  for each row execute function public.set_updated_at();
create index listings_seller_idx    on public.listings (seller_id);
create index listings_category_idx  on public.listings (category_id);
create index listings_status_idx    on public.listings (status);
create index listings_search_idx    on public.listings using gin (search_vector);
create index listings_title_trgm_idx on public.listings using gin (title gin_trgm_ops);

-- ============ LISTING IMAGES ============
create table public.listing_images (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings (id) on delete cascade,
  storage_path text not null,
  position     smallint not null default 0,
  created_at   timestamptz not null default now(),
  unique (listing_id, position)
);
create index listing_images_listing_idx on public.listing_images (listing_id);

-- ============ CONVERSATIONS & MESSAGES ============
create table public.conversations (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  buyer_id   uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (listing_id, buyer_id)
);
create index conversations_buyer_idx on public.conversations (buyer_id);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  body            text not null check (char_length(body) between 1 and 2000),
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index messages_conversation_idx
  on public.messages (conversation_id, created_at);

-- ============ ORDERS ============
create table public.orders (
  id                     uuid primary key default gen_random_uuid(),
  listing_id             uuid not null references public.listings (id) on delete restrict,
  buyer_id               uuid not null references public.profiles (id) on delete restrict,
  seller_id              uuid not null references public.profiles (id) on delete restrict,
  listing_title_snapshot text not null,
  quantity               integer not null check (quantity > 0),
  unit_price             numeric(12,2) not null check (unit_price > 0),
  total_amount           numeric(12,2) not null check (total_amount > 0),
  currency               text not null default 'KES',
  status                 public.order_status not null default 'pending_payment',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint buyer_is_not_seller check (buyer_id <> seller_id)
);
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();
create index orders_buyer_idx  on public.orders (buyer_id);
create index orders_seller_idx on public.orders (seller_id);
create index orders_status_idx on public.orders (status);

-- ============ PAYMENTS (Paystack audit trail) ============
create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete restrict,
  provider     text not null default 'paystack',
  method       public.payment_method not null,
  provider_ref text unique,
  amount       numeric(12,2) not null check (amount > 0),
  currency     text not null default 'KES',
  status       public.payment_status not null default 'initiated',
  raw_payload  jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger payments_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
create index payments_order_idx on public.payments (order_id);

-- ============ PAYOUTS ============
create table public.payouts (
  id           uuid primary key default gen_random_uuid(),
  seller_id    uuid not null references public.profiles (id) on delete restrict,
  order_id     uuid references public.orders (id) on delete restrict,
  amount       numeric(12,2) not null check (amount > 0),
  currency     text not null default 'KES',
  status       public.payout_status not null default 'pending',
  provider_ref text unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger payouts_updated_at before update on public.payouts
  for each row execute function public.set_updated_at();
create index payouts_seller_idx on public.payouts (seller_id);

-- ============ REVIEWS ============
create table public.reviews (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null unique references public.orders (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  seller_id   uuid not null references public.profiles (id) on delete cascade,
  listing_id  uuid not null references public.listings (id) on delete cascade,
  rating      smallint not null check (rating between 1 and 5),
  comment     text check (char_length(comment) <= 1000),
  created_at  timestamptz not null default now()
);
create index reviews_seller_idx  on public.reviews (seller_id);
create index reviews_listing_idx on public.reviews (listing_id);
