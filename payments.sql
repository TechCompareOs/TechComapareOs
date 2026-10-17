-- TechCompare OS payments: run in Supabase > SQL Editor AFTER setup.sql. Safe to run again.

-- Seller payout + collection details (needed for PayFast split + Courier Guy pickup)
create table if not exists public.seller_profiles (
  seller_email        text primary key,
  full_name           text not null check (char_length(full_name) between 2 and 100),
  phone               text not null check (char_length(phone) between 9 and 15),
  payfast_merchant_id text not null check (payfast_merchant_id ~ '^[0-9]{4,12}$'),
  street_address      text not null,
  local_area          text not null,
  city                text not null,
  province            text not null,
  postal_code         text not null check (postal_code ~ '^[0-9]{4}$'),
  updated_at          timestamptz default now()
);

alter table public.seller_profiles enable row level security;

drop policy if exists "Sellers read own profile"   on public.seller_profiles;
drop policy if exists "Sellers insert own profile" on public.seller_profiles;
drop policy if exists "Sellers update own profile" on public.seller_profiles;

create policy "Sellers read own profile" on public.seller_profiles for select to authenticated
  using (lower(seller_email) = public.current_email());
create policy "Sellers insert own profile" on public.seller_profiles for insert to authenticated
  with check (public.is_tut_email() and lower(seller_email) = public.current_email());
create policy "Sellers update own profile" on public.seller_profiles for update to authenticated
  using (lower(seller_email) = public.current_email())
  with check (lower(seller_email) = public.current_email());

-- Make sure listings have a price (skip if you already have one)
alter table public.products add column if not exists price numeric(10,2);

-- Orders: written ONLY by the Edge Functions (service role). Browsers can only read their own.
create table if not exists public.orders (
  id                  uuid primary key default gen_random_uuid(),
  product_id          text not null,
  product_title       text,
  buyer_email         text not null,
  seller_email        text not null,
  buyer_name          text not null,
  buyer_phone         text not null,
  delivery_address    jsonb not null,
  service_level_code  text not null,
  service_level_name  text,
  item_cents          integer not null check (item_cents > 0),
  shipping_cents      integer not null check (shipping_cents >= 0),
  fee_cents           integer not null check (fee_cents >= 0),
  total_cents         integer not null check (total_cents > 0),
  status              text not null default 'pending'
                      check (status in ('pending','paid','cancelled','failed')),
  pf_payment_id       text,
  shipment_id         text,
  tracking_reference  text,
  courier_error       text,
  created_at          timestamptz default now(),
  paid_at             timestamptz
);

create index if not exists orders_buyer_idx  on public.orders (lower(buyer_email));
create index if not exists orders_seller_idx on public.orders (lower(seller_email));

alter table public.orders enable row level security;

drop policy if exists "Read your own orders" on public.orders;
create policy "Read your own orders" on public.orders for select to authenticated
  using (
    lower(buyer_email)  = public.current_email()
    or lower(seller_email) = public.current_email()
  );
-- No insert/update/delete policies on purpose: clients cannot create or edit orders.
