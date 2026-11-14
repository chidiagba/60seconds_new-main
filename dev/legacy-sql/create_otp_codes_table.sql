-- OTP codes for signup and password recovery (in-app verification, no email link)
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

create table if not exists public.otp_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code text not null,
  type text not null check (type in ('signup', 'recovery')),
  user_id uuid null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_otp_codes_email_type on public.otp_codes (email, type);
create index if not exists idx_otp_codes_expires on public.otp_codes (expires_at);

alter table public.otp_codes enable row level security;
