-- Add one-time, owner-authorized admission validation for paid event-table bookings.
-- This migration adds no historical rows and changes no booking/payment state.

alter table public.event_table_bookings
  add column if not exists checked_in_at timestamptz,
  add column if not exists checked_in_by uuid references public.profiles(id) on delete set null;

do $$
begin
  if exists (
    select 1 from public.event_table_bookings
    group by qr_code having count(*) > 1
  ) then
    raise exception 'Duplicate event-table QR values exist; review them before installing the unique index';
  end if;
end $$;

create unique index if not exists event_table_bookings_qr_code_unique
  on public.event_table_bookings(qr_code);

create or replace function public.redeem_event_table_booking(booking_qr_code text)
returns table (
  receipt_id uuid,
  order_id uuid,
  order_number text,
  ticket_title text,
  event_name text,
  buyer_id uuid,
  redeemed_at timestamptz,
  order_status text,
  receipt_kind text,
  quantity integer,
  total_price numeric,
  currency text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  booking public.event_table_bookings%rowtype;
  purchase public.orders%rowtype;
  event public.events%rowtype;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if nullif(btrim(booking_qr_code), '') is null then
    raise exception using errcode = '22023', message = 'Invalid table reservation QR code';
  end if;

  select * into booking
  from public.event_table_bookings b
  where b.qr_code = booking_qr_code
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Table reservation not found';
  end if;
  if booking.checked_in_at is not null then
    raise exception using errcode = 'P0001', message = 'Table reservation has already been checked in';
  end if;
  if booking.state <> 'confirmed' then
    raise exception using errcode = 'P0001', message = 'Only paid table reservations can be checked in';
  end if;

  select * into purchase from public.orders o where o.id = booking.order_id for share;
  select * into event from public.events e where e.id = booking.event_id;
  if not found or purchase.payment_status <> 'paid' then
    raise exception using errcode = 'P0001', message = 'Paid reservation not found';
  end if;
  if coalesce(event.business_id, event.user_id) is distinct from actor_id then
    raise exception using errcode = '42501', message = 'This reservation belongs to another organizer';
  end if;

  update public.event_table_bookings b
  set checked_in_at = now(), checked_in_by = actor_id
  where b.id = booking.id and b.checked_in_at is null
  returning * into booking;

  return query select booking.id, purchase.id, purchase.order_number,
    booking.table_name || ' — ' || booking.seats::text || ' guests', event.event_name,
    purchase.user_id, booking.checked_in_at, purchase.status, 'reservation',
    booking.seats, booking.unit_price * booking.seats, booking.currency;
end;
$$;

revoke all on function public.redeem_event_table_booking(text) from public, anon;
grant execute on function public.redeem_event_table_booking(text) to authenticated;
