-- A random bearer code is separate from sequential order numbers and admission QR values.
-- Existing guest rows receive a code; no payment, receipt, email or order state is changed.
alter table public.guest_checkouts add column if not exists tracking_code uuid default gen_random_uuid();
create unique index if not exists guest_checkouts_tracking_code_unique on public.guest_checkouts(tracking_code);
-- Do not expose tracking codes through existing client column grants.
revoke select(tracking_code),insert(tracking_code),update(tracking_code) on public.guest_checkouts from anon,authenticated;
