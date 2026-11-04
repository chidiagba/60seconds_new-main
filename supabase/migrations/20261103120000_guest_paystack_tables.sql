alter table public.guest_checkouts
 add column provider text not null default 'stripe' check(provider in ('stripe','paystack')),
 add column expires_at timestamptz not null default (now()+interval '30 minutes'),
 add column refund_pending boolean not null default false,
 add column refund_id text;
