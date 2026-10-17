-- TechCompare OS: you receive all payments and pay sellers yourself.
-- Run in Supabase > SQL Editor BEFORE deploying the new main.py. Safe to run again.

-- 1. Sellers now give bank details instead of a PayFast merchant ID
alter table public.seller_profiles
  alter column payfast_merchant_id drop not null,
  add column if not exists bank_name      text,
  add column if not exists account_holder text,
  add column if not exists account_number text,
  add column if not exists account_type   text,
  add column if not exists branch_code    text;

alter table public.seller_profiles drop constraint if exists seller_bank_check;
alter table public.seller_profiles add constraint seller_bank_check check (
  (account_number is null or account_number ~ '^[0-9]{6,16}$')
  and (branch_code is null or branch_code ~ '^[0-9]{6}$')
  and (account_type is null or account_type in ('Cheque', 'Savings'))
);

-- 2. Payout tracking on each order
alter table public.orders
  add column if not exists payout_cents       integer,
  add column if not exists payout_status      text not null default 'held',
  add column if not exists buyer_confirmed_at timestamptz,
  add column if not exists paid_out_at        timestamptz,
  add column if not exists payout_reference   text;

do $$
begin
  alter table public.orders
    add constraint orders_payout_status_check check (payout_status in ('held', 'ready', 'paid'));
exception when duplicate_object then null;
end $$;

-- 3. Your payout list: open it in Table Editor. An order shows up when the buyer has
--    confirmed receipt ('ready') OR 7 days have passed since payment.
--    Locked down so nobody can read it through the public website API.
create or replace view public.payouts_due
with (security_invoker = true) as
select o.id as order_id,
       o.product_title,
       o.paid_at,
       o.buyer_confirmed_at,
       o.payout_status,
       (o.item_cents - o.fee_cents) / 100.0 as amount_rands,
       s.full_name, s.seller_email, s.phone,
       s.bank_name, s.account_holder, s.account_number, s.account_type, s.branch_code
from public.orders o
join public.seller_profiles s on lower(s.seller_email) = lower(o.seller_email)
where o.status = 'paid'
  and o.payout_status <> 'paid'
  and (o.payout_status = 'ready' or o.paid_at < now() - interval '7 days')
order by o.paid_at;

revoke all on public.payouts_due from anon, authenticated;

-- After you send a seller their money, mark the order as paid out (replace the id and reference):
--   update public.orders
--      set payout_status = 'paid', paid_out_at = now(), payout_reference = 'EFT 2026-11-03'
--    where id = 'PASTE-ORDER-ID-HERE';
