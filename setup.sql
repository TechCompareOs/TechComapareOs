-- TechCompare OS: run in Supabase > SQL Editor. Safe to run again.
-- Run this BEFORE uploading the new app.js, because the site now reads the
-- "status" and "expires_at" columns created below.
--
-- It sets up: listing columns, 30-day expiry, picture storage, live chat,
-- the contact form, and Row Level Security (who may read or change what).

-- =====================================================================
-- 1. Listing columns
-- =====================================================================
alter table public.products
  add column if not exists title        text,
  add column if not exists description  text,
  add column if not exists image_url    text,
  add column if not exists seller_email text,
  add column if not exists created_at   timestamptz default now(),
  add column if not exists status       text not null default 'Available',
  add column if not exists expires_at   timestamptz default (now() + interval '30 days');

-- Existing listings get 30 days from now, so none vanish the moment this runs
update public.products
   set expires_at = now() + interval '30 days'
 where expires_at is null;

alter table public.products
  alter column expires_at set default (now() + interval '30 days');

-- A listing is either Available or Sold
do $$
begin
  alter table public.products
    add constraint products_status_check check (status in ('Available', 'Sold'));
exception when duplicate_object then null;
end $$;

create index if not exists products_status_expires_idx
  on public.products (status, expires_at);

-- If your table has an old NOT NULL "name" column, relax it so inserts using "title" work
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'name'
  ) then
    alter table public.products alter column name drop not null;
  end if;
end $$;

-- =====================================================================
-- 2. The 30-day limit is enforced here, not only in the browser:
--    nobody can push a listing's expiry more than 30 days into the future.
-- =====================================================================
create or replace function public.clamp_listing_expiry()
returns trigger
language plpgsql
as $$
begin
  if new.expires_at is null or new.expires_at > now() + interval '30 days' then
    new.expires_at := now() + interval '30 days';
  end if;
  return new;
end;
$$;

drop trigger if exists clamp_listing_expiry_trg on public.products;
create trigger clamp_listing_expiry_trg
  before insert or update on public.products
  for each row execute function public.clamp_listing_expiry();

-- =====================================================================
-- 3. Helpers for the access rules
-- =====================================================================
create or replace function public.current_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.is_tut_email()
returns boolean
language sql
stable
as $$
  select public.current_email() like '%@tut4life.ac.za'
      or public.current_email() like '%@tut.ac.za'
$$;

-- =====================================================================
-- 4. Row Level Security: products
--    This first removes any older policies on the table, so that only the
--    rules below apply.
-- =====================================================================
alter table public.products enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'products'
  loop
    execute format('drop policy %I on public.products', p.policyname);
  end loop;
end $$;

-- Only signed-in students can read listings (they include seller emails, which
-- must not be public). They see live listings; a seller also sees their own
-- sold and expired ones.
create policy "Read live listings and your own"
  on public.products for select
  to authenticated
  using (
    (status = 'Available' and expires_at > now())
    or lower(seller_email) = public.current_email()
  );

-- Only verified TUT students can post, and only as themselves
create policy "TUT students can post their own listings"
  on public.products for insert
  to authenticated
  with check (
    public.is_tut_email()
    and lower(seller_email) = public.current_email()
  );

-- Only the seller can change or delete their own listing
create policy "Sellers can update their own listings"
  on public.products for update
  to authenticated
  using (lower(seller_email) = public.current_email())
  with check (lower(seller_email) = public.current_email());

create policy "Sellers can delete their own listings"
  on public.products for delete
  to authenticated
  using (lower(seller_email) = public.current_email());

-- =====================================================================
-- 5. Row Level Security: chat messages (only the two people in a chat can read it)
-- =====================================================================
alter table public.messages enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'messages'
  loop
    execute format('drop policy %I on public.messages', p.policyname);
  end loop;
end $$;

create policy "Read your own messages"
  on public.messages for select
  to authenticated
  using (
    lower(sender_email) = public.current_email()
    or lower(receiver_email) = public.current_email()
  );

create policy "TUT students can send messages as themselves"
  on public.messages for insert
  to authenticated
  with check (
    public.is_tut_email()
    and lower(sender_email) = public.current_email()
  );

-- =====================================================================
-- 6. Picture storage: a public bucket; each student can only add or delete
--    pictures inside their own folder (the app saves to <user id>/<file>)
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

drop policy if exists "Signed-in users can upload product images" on storage.objects;
drop policy if exists "Students upload to their own folder" on storage.objects;
create policy "Students upload to their own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Students delete their own pictures" on storage.objects;
create policy "Students delete their own pictures"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Anyone can view product images" on storage.objects;
create policy "Anyone can view product images"
  on storage.objects for select
  using (bucket_id = 'product-images');

-- =====================================================================
-- 7. Live chat: let the chat receive new messages instantly
-- =====================================================================
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;

-- =====================================================================
-- 8. Contact page: anyone can send a message; nobody can read them through
--    the public API (read them in Supabase > Table Editor)
-- =====================================================================
create table if not exists public.contact_messages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 100),
  email      text not null check (char_length(email) between 3 and 200),
  message    text not null check (char_length(message) between 10 and 1000),
  created_at timestamptz default now()
);

alter table public.contact_messages enable row level security;

drop policy if exists "Anyone can send a contact message" on public.contact_messages;
create policy "Anyone can send a contact message"
  on public.contact_messages for insert
  to anon, authenticated
  with check (true);

-- =====================================================================
-- Optional: align older rows with the Laptop / Phone / Tablet filter values
-- =====================================================================
-- update public.products set category = 'Laptop' where category = 'Laptops';
-- update public.products set category = 'Phone'  where category = 'Smartphones';
