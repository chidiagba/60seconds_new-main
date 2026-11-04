-- =====================================================================
-- 60seconds · Table reservations
-- Businesses list bookable tables (name, location, photos, capacity,
-- pricing); guests reserve them for a time slot.
--
-- Business identities use the existing profiles table.
-- Original package assumption: a table public.profiles(id uuid, owner_id uuid) already exists
-- for business profiles. If your venue/business table or owner column has
-- a different name, change ONLY public.is_venue_manager() below.
-- =====================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- Who may manage a venue's tables and reservations
-- ---------------------------------------------------------------------
create or replace function public.is_venue_manager(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles v
    where v.id = p_venue_id
      and v.id = auth.uid() and v.user_type = 'business'
  );
$$;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
do $$ begin
  create type public.reservation_status as enum
    ('pending', 'confirmed', 'declined', 'cancelled', 'completed', 'no_show');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Tables a venue offers
-- ---------------------------------------------------------------------
create table if not exists public.venue_tables (
  id                        uuid primary key default gen_random_uuid(),
  venue_id                  uuid not null references public.profiles(id) on delete cascade,
  name                      text not null check (char_length(name) between 1 and 80),
  location                  text check (char_length(location) <= 120),   -- e.g. "VIP balcony, next to DJ booth"
  description               text check (char_length(description) <= 1000),
  min_guests                int  not null default 1  check (min_guests >= 1),
  max_guests                int  not null default 6  check (max_guests >= min_guests),
  minimum_spend             numeric(10,2) check (minimum_spend >= 0),
  deposit_amount            numeric(10,2) check (deposit_amount >= 0),
  currency                  char(3) not null default 'EUR',
  booking_duration_minutes  int  not null default 180 check (booking_duration_minutes between 30 and 720),
  requires_approval         boolean not null default true,  -- false = instant confirmation
  is_active                 boolean not null default true,
  sort_order                int  not null default 0,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index if not exists venue_tables_venue_idx on public.venue_tables (venue_id, sort_order);

-- ---------------------------------------------------------------------
-- Photos of a table (files live in the "table-images" storage bucket)
-- ---------------------------------------------------------------------
create table if not exists public.venue_table_images (
  id            uuid primary key default gen_random_uuid(),
  table_id      uuid not null references public.venue_tables(id) on delete cascade,
  storage_path  text not null unique,   -- "{venue_id}/{table_id}/{file}.jpg"
  position      int  not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists venue_table_images_table_idx on public.venue_table_images (table_id, position);

-- ---------------------------------------------------------------------
-- Reservations
-- ---------------------------------------------------------------------
create table if not exists public.table_reservations (
  id             uuid primary key default gen_random_uuid(),
  table_id       uuid not null references public.venue_tables(id) on delete cascade,
  venue_id       uuid not null references public.profiles(id) on delete cascade,
  guest_id       uuid not null references auth.users(id) on delete cascade,
  party_size     int  not null check (party_size >= 1),
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  status         public.reservation_status not null default 'pending',
  guest_note     text check (char_length(guest_note) <= 500),
  business_note  text check (char_length(business_note) <= 500),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (ends_at > starts_at),
  -- A table can never hold two live bookings that overlap in time.
  constraint table_reservations_no_overlap
    exclude using gist (table_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
    where (status in ('pending', 'confirmed'))
);
create index if not exists table_reservations_guest_idx on public.table_reservations (guest_id, starts_at desc);
create index if not exists table_reservations_venue_idx on public.table_reservations (venue_id, starts_at);

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------
create or replace function public.touch_table_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists venue_tables_touch on public.venue_tables;
create trigger venue_tables_touch before update on public.venue_tables
  for each row execute function public.touch_table_updated_at();

drop trigger if exists table_reservations_touch on public.table_reservations;
create trigger table_reservations_touch before update on public.table_reservations
  for each row execute function public.touch_table_updated_at();

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------
alter table public.venue_tables        enable row level security;
alter table public.venue_table_images  enable row level security;
alter table public.table_reservations  enable row level security;

-- venue_tables: everyone sees active tables; managers see and edit all of theirs
drop policy if exists "tables readable" on public.venue_tables;
create policy "tables readable" on public.venue_tables
  for select using (is_active or public.is_venue_manager(venue_id));

drop policy if exists "tables managed by venue" on public.venue_tables;
create policy "tables managed by venue" on public.venue_tables
  for all to authenticated
  using (public.is_venue_manager(venue_id))
  with check (public.is_venue_manager(venue_id));

-- venue_table_images: readable with the table; managers edit
drop policy if exists "images readable" on public.venue_table_images;
create policy "images readable" on public.venue_table_images
  for select using (
    exists (select 1 from public.venue_tables t
            where t.id = table_id and (t.is_active or public.is_venue_manager(t.venue_id)))
  );

drop policy if exists "images managed by venue" on public.venue_table_images;
create policy "images managed by venue" on public.venue_table_images
  for all to authenticated
  using (exists (select 1 from public.venue_tables t
                 where t.id = table_id and public.is_venue_manager(t.venue_id)))
  with check (exists (select 1 from public.venue_tables t
                      where t.id = table_id and public.is_venue_manager(t.venue_id)));

-- table_reservations: read-only through RLS; all writes go through the RPCs below
drop policy if exists "reservations visible to guest and venue" on public.table_reservations;
create policy "reservations visible to guest and venue" on public.table_reservations
  for select to authenticated
  using (guest_id = auth.uid() or public.is_venue_manager(venue_id));

-- ---------------------------------------------------------------------
-- RPC: busy time ranges for a venue's tables (no guest details exposed)
-- ---------------------------------------------------------------------
create or replace function public.get_table_availability(
  p_venue_id uuid, p_from timestamptz, p_to timestamptz)
returns table (table_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.table_id, r.starts_at, r.ends_at
  from public.table_reservations r
  where r.venue_id = p_venue_id
    and r.status in ('pending', 'confirmed')
    and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(p_from, p_to, '[)')
  order by r.starts_at;
$$;

-- ---------------------------------------------------------------------
-- RPC: guest books a table
-- ---------------------------------------------------------------------
create or replace function public.create_table_reservation(
  p_table_id uuid, p_starts_at timestamptz, p_party_size int, p_note text default null)
returns public.table_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_table public.venue_tables;
  v_row   public.table_reservations;
begin
  if v_uid is null then
    raise exception 'You need to be signed in to reserve a table' using errcode = '28000';
  end if;

  select * into v_table from public.venue_tables where id = p_table_id and is_active for share;
  if not found then
    raise exception 'This table is not available for booking' using errcode = 'P0002';
  end if;

  if p_starts_at < now() then
    raise exception 'Please pick a time in the future' using errcode = '22023';
  end if;

  if p_party_size < v_table.min_guests or p_party_size > v_table.max_guests then
    raise exception 'This table is for % to % guests', v_table.min_guests, v_table.max_guests
      using errcode = '22023';
  end if;

  begin
    insert into public.table_reservations
      (table_id, venue_id, guest_id, party_size, starts_at, ends_at, status, guest_note)
    values
      (v_table.id, v_table.venue_id, v_uid, p_party_size, p_starts_at,
       p_starts_at + make_interval(mins => v_table.booking_duration_minutes),
       case when v_table.requires_approval then 'pending'::public.reservation_status
            else 'confirmed'::public.reservation_status end,
       nullif(trim(p_note), ''))
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'Sorry, this table was just booked for that time' using errcode = '23P01';
  end;

  return v_row;
end $$;

-- ---------------------------------------------------------------------
-- RPC: status changes
--   guest:    pending/confirmed -> cancelled (before start time)
--   business: pending -> confirmed | declined
--             pending/confirmed -> cancelled
--             confirmed -> completed | no_show
-- ---------------------------------------------------------------------
create or replace function public.update_table_reservation_status(
  p_reservation_id uuid, p_status public.reservation_status, p_business_note text default null)
returns public.table_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_row     public.table_reservations;
  v_manager boolean;
begin
  select * into v_row from public.table_reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;

  v_manager := public.is_venue_manager(v_row.venue_id);

  if not v_manager and v_row.guest_id is distinct from v_uid then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;

  if v_manager then
    if not (
         (v_row.status = 'pending'   and p_status in ('confirmed', 'declined', 'cancelled'))
      or (v_row.status = 'confirmed' and p_status in ('cancelled', 'completed', 'no_show'))
    ) then
      raise exception 'Cannot change a % reservation to %', v_row.status, p_status using errcode = '22023';
    end if;
  else
    if not (v_row.status in ('pending', 'confirmed') and p_status = 'cancelled') then
      raise exception 'You can only cancel an upcoming reservation' using errcode = '22023';
    end if;
    if v_row.starts_at <= now() then
      raise exception 'This reservation has already started' using errcode = '22023';
    end if;
  end if;

  update public.table_reservations
     set status = p_status,
         business_note = case when v_manager then coalesce(nullif(trim(p_business_note), ''), business_note)
                              else business_note end
   where id = p_reservation_id
  returning * into v_row;

  return v_row;
end $$;

revoke all on function public.create_table_reservation(uuid, timestamptz, int, text) from public, anon;
revoke all on function public.update_table_reservation_status(uuid, public.reservation_status, text) from public, anon;
grant execute on function public.create_table_reservation(uuid, timestamptz, int, text) to authenticated;
grant execute on function public.update_table_reservation_status(uuid, public.reservation_status, text) to authenticated;
grant execute on function public.get_table_availability(uuid, timestamptz, timestamptz) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Storage: public bucket for table photos, path "{venue_id}/{table_id}/{file}"
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('table-images', 'table-images', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

drop policy if exists "table images public read" on storage.objects;
create policy "table images public read" on storage.objects
  for select using (bucket_id = 'table-images');

drop policy if exists "table images venue upload" on storage.objects;
create policy "table images venue upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'table-images'
              and public.is_venue_manager(((storage.foldername(name))[1])::uuid));

drop policy if exists "table images venue update" on storage.objects;
create policy "table images venue update" on storage.objects
  for update to authenticated
  using (bucket_id = 'table-images'
         and public.is_venue_manager(((storage.foldername(name))[1])::uuid));

drop policy if exists "table images venue delete" on storage.objects;
create policy "table images venue delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'table-images'
         and public.is_venue_manager(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------------
-- Realtime: let the business inbox update live (optional)
-- ---------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.table_reservations;
exception when undefined_object or duplicate_object then null; end $$;

-- Explicit privileges; reservation writes remain RPC-only.
grant select on public.venue_tables, public.venue_table_images to anon, authenticated;
grant insert, update, delete on public.venue_tables, public.venue_table_images to authenticated;
revoke all on public.table_reservations from anon, authenticated;
grant select on public.table_reservations to authenticated;

-- Percentage coordinates keep the floor plan responsive on every device.
alter table public.venue_tables
  add column if not exists map_x numeric not null default 50 check (map_x between 8 and 92),
  add column if not exists map_y numeric not null default 50 check (map_y between 6 and 94),
  add column if not exists map_color text not null default '#ff963f'
    check (map_color in ('#ff963f', '#28c5f6', '#ee62d2'));
