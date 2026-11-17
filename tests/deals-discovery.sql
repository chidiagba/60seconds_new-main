\set ON_ERROR_STOP on
begin;
create table public.events(id uuid primary key, event_name text, video_id uuid, creator_id uuid, user_id uuid, is_public boolean, status text, start_date timestamptz, end_date timestamptz, created_at timestamptz default now());
create table public.products(id integer generated always as identity, event_id uuid, is_active boolean, available_quantity integer, price numeric);
create table public.event_tables(id integer primary key, event_id uuid, is_active boolean, seat_price numeric, seats integer, whole_table boolean);
create table public.event_table_bookings(table_id integer, seats integer, state text);
create table public.videos(id uuid primary key, title text, thumbnail_url text, video_url text);
create table public.profiles(id uuid primary key, username text, full_name text, avatar_url text, email text);
\ir ../supabase/migrations/20261116150000_public_deals_discovery.sql
insert into events(id,event_name,is_public,status,start_date,end_date)
select ('00000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid, 'event-'||i,true,'open',now()+interval '1 day',now()+interval '2 days' from generate_series(1,12) i;
-- Ticket/product, table-only, full table, partial exclusive table, partial shared table,
-- inactive, sold out, zero price, ended, private, draft, and no offers.
insert into products(event_id,is_active,available_quantity,price)
select id,true,2,10 from events where event_name in ('event-1','event-6','event-7','event-8','event-9','event-10','event-11');
update products set is_active=false where event_id=(select id from events where event_name='event-6');
update products set available_quantity=0 where event_id=(select id from events where event_name='event-7');
update products set price=0 where event_id=(select id from events where event_name='event-8');
update events set end_date=now()-interval '1 second' where event_name='event-9';
update events set is_public=false where event_name='event-10';
update events set status='draft' where event_name='event-11';
insert into event_tables select i,id,true,20,4,i=4 from events cross join lateral (select substring(event_name from 7)::integer i) n where i between 2 and 5;
insert into event_table_bookings values(3,4,'confirmed'),(4,1,'held'),(5,3,'confirmed'),(2,4,'released');
do $$ declare result jsonb; names text[]; begin
  result:=public.public_deals_events(60,0);
  select array_agg(x->>'event_name' order by x->>'event_name') into names from jsonb_array_elements(result->'events') x;
  if names <> array['event-1','event-2','event-5'] then raise exception 'Incorrect eligible events: %', names; end if;
  if (result->>'hasMore')::boolean then raise exception 'Unexpected next page'; end if;
  result:=public.public_deals_events(2,0);
  if jsonb_array_length(result->'events')<>2 or not (result->>'hasMore')::boolean then raise exception 'First page incorrect'; end if;
  result:=public.public_deals_events(2,2);
  if jsonb_array_length(result->'events')<>1 or (result->>'hasMore')::boolean then raise exception 'Last page incorrect'; end if;
  if has_function_privilege('anon','public.public_deals_events(integer,integer)','execute') or has_function_privilege('authenticated','public.public_deals_events(integer,integer)','execute') then raise exception 'Inventory query exposed directly'; end if;
  if not has_function_privilege('service_role','public.public_deals_events(integer,integer)','execute') then raise exception 'Service cannot read deals'; end if;
end $$;
rollback;
