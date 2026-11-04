-- Event seats share the existing guest order, Stripe checkout and reconciliation lifecycle.
create table public.event_tables (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.events(id),
 name text not null check (length(trim(name)) between 1 and 80),
 seats integer not null check (seats between 1 and 500),
 seat_price numeric(12,2) not null check (seat_price > 0 and seat_price <> 'NaN'::numeric),
 is_active boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.event_table_bookings (
 id uuid primary key default gen_random_uuid(),
 table_id uuid not null references public.event_tables(id),
 event_id uuid not null references public.events(id),
 order_id uuid not null references public.orders(id),
 guest_email text not null,
 seats integer not null check (seats > 0),
 table_name text not null,
 unit_price numeric not null,
 currency text not null,
 state text not null default 'held' check (state in ('held','confirmed','released')),
 qr_code text not null default ('TABLE:' || gen_random_uuid()::text),
 created_at timestamptz not null default now(),
 unique(order_id,table_id)
);
create index on public.event_tables(event_id);
create index on public.event_table_bookings(table_id,state);
create index on public.event_table_bookings(order_id);
alter table public.event_tables enable row level security;
alter table public.event_table_bookings enable row level security;

create function public.verified_booking_email() returns text language sql stable security definer set search_path=public as $$
 select lower(email) from auth.users where id=auth.uid() and email_confirmed_at is not null;
$$;
revoke all on function public.verified_booking_email() from public;
grant execute on function public.verified_booking_email() to authenticated;
create policy "event owners read their tables" on public.event_tables for select to authenticated using (
 exists(select 1 from public.events e where e.id=event_id and coalesce(e.business_id,e.user_id)=auth.uid())
);
create policy "paid reservations visible to buyer and owner" on public.event_table_bookings for select to authenticated using (
 state='confirmed' and (guest_email=public.verified_booking_email() or exists(
 select 1 from public.events e where e.id=event_id and coalesce(e.business_id,e.user_id)=auth.uid()))
);

-- All table edits serialize with seat holds. Capacity cannot shrink below allocated seats.
create function public.save_event_table(event_key uuid, table_key uuid, table_name text, seat_count integer, price numeric, active boolean)
returns public.event_tables language plpgsql security definer set search_path=public as $$
declare t public.event_tables; allocated integer;
begin
 if not exists(select 1 from public.events e join public.profiles p on p.id=coalesce(e.business_id,e.user_id)
 where e.id=event_key and p.id=auth.uid() and p.user_type='business') then raise exception 'Only the event owner can manage tables'; end if;
 if table_key is null then
 insert into public.event_tables(event_id,name,seats,seat_price,is_active) values(event_key,trim(table_name),seat_count,price,active) returning * into t;
 else
 select * into t from public.event_tables where id=table_key and event_id=event_key for update;
 if not found then raise exception 'Table not found'; end if;
 select coalesce(sum(seats),0) into allocated from public.event_table_bookings where table_id=t.id and state in ('held','confirmed');
 if seat_count < allocated then raise exception 'Capacity cannot be lower than held or paid seats (%)',allocated; end if;
 update public.event_tables set name=trim(table_name),seats=seat_count,seat_price=price,is_active=active where id=t.id returning * into t;
 end if;
 return t;
end $$;
revoke all on function public.save_event_table(uuid,uuid,text,integer,numeric,boolean) from public;
grant execute on function public.save_event_table(uuid,uuid,text,integer,numeric,boolean) to authenticated;

create function public.event_table_inventory(event_key uuid) returns table(id uuid,name text,seats integer,seat_price numeric,available_seats bigint)
language sql stable security definer set search_path=public as $$
 select t.id,t.name,t.seats,t.seat_price,t.seats-coalesce((select sum(b.seats) from public.event_table_bookings b where b.table_id=t.id and b.state in ('held','confirmed')),0)
 from public.event_tables t where t.event_id=event_key and t.is_active;
$$;
revoke all on function public.event_table_inventory(uuid) from public,anon,authenticated;
grant execute on function public.event_table_inventory(uuid) to service_role;

create function public.reserve_event_order(event_key uuid,buyer_email text,requested_items jsonb,requested_tables jsonb)
returns public.orders language plpgsql security definer set search_path=public as $$
declare e public.events; o public.orders; t public.event_tables; item jsonb; qty integer; allocated integer; digits integer; unit numeric; total numeric; lines jsonb;
begin
 select * into e from public.events where id=event_key and is_public and status in ('open','published') for share;
 if not found or now()>=coalesce(e.end_date,e.start_date) then raise exception 'This event is no longer accepting bookings'; end if;
 if buyer_email is null or trim(buyer_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(buyer_email)>254 then raise exception 'Enter a valid email address'; end if;
 if requested_items is null or jsonb_typeof(requested_items)<>'array' or requested_tables is null or jsonb_typeof(requested_tables)<>'array' then raise exception 'Invalid basket'; end if;
 if jsonb_array_length(requested_tables)>20 then raise exception 'Too many tables'; end if;
 if jsonb_array_length(requested_items)>0 then
 o:=public.reserve_guest_order(event_key,trim(buyer_email),requested_items);
 else
 if jsonb_array_length(requested_tables)=0 then raise exception 'Select tickets, products or table seats'; end if;
 insert into public.orders(user_id,business_id,event_id,video_id,guest_email,items,subtotal,total_amount,currency,status,payment_status,payment_method)
 values(null,coalesce(e.business_id,e.user_id),e.id,e.video_id,lower(trim(buyer_email)),'[]',0,0,upper(e.currency),'pending','pending','stripe') returning * into o;
 insert into public.guest_checkouts(order_id) values(o.id);
 end if;
 total:=o.total_amount; lines:=o.items;
 digits:=case when upper(e.currency) in ('BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF') then 0 else 2 end;
 for item in select jsonb_build_object('id',value->>'id','quantity',sum((value->>'quantity')::integer)) from jsonb_array_elements(requested_tables) group by value->>'id' order by value->>'id' loop
 qty:=(item->>'quantity')::integer;
 if qty is null or qty not between 1 and 500 then raise exception 'Invalid seat count'; end if;
 select * into t from public.event_tables where id=(item->>'id')::uuid and event_id=e.id and is_active for update;
 if not found then raise exception 'Table unavailable'; end if;
 select coalesce(sum(seats),0) into allocated from public.event_table_bookings where table_id=t.id and state in ('held','confirmed');
 if t.seats-allocated<qty then raise exception 'Not enough seats available at %',t.name; end if;
 unit:=round(t.seat_price*1.04,digits);
 if unit<=0 then raise exception 'Seat price is too low for this currency'; end if;
 insert into public.event_table_bookings(table_id,event_id,order_id,guest_email,seats,table_name,unit_price,currency)
 values(t.id,e.id,o.id,o.guest_email,qty,t.name,unit,o.currency);
 lines:=lines || jsonb_build_array(jsonb_build_object('table_id',t.id,'name',t.name || ' — seat','quantity',qty,'price',unit,'type','table'));
 total:=total+unit*qty;
 end loop;
 update public.orders set items=lines,subtotal=total,total_amount=total where id=o.id returning * into o;
 return o;
end $$;
revoke all on function public.reserve_event_order(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_event_order(uuid,text,jsonb,jsonb) to service_role;

-- Retire unpaid venue-level booking, including calls from old app versions.
create or replace function public.create_table_reservation(p_table_id uuid,p_starts_at timestamptz,p_party_size integer,p_note text default null)
returns public.table_reservations language plpgsql security definer set search_path=public as $$
begin raise exception 'Reserve table seats from the event page and complete payment to confirm your reservation'; end $$;

create or replace function public.finish_guest_order(order_key uuid, paid boolean, session_key text)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype; g public.guest_checkouts%rowtype; e public.events%rowtype; item jsonb; i integer; qty integer; ticket boolean;
begin
 select * into o from public.orders where id=order_key for update;
 select * into g from public.guest_checkouts where order_id=order_key for update;
 if not found then raise exception 'Guest order not found'; end if;
 if g.session_id is not null and g.session_id <> session_key then raise exception 'Session mismatch'; end if;
 if g.state <> 'reserved' then return o; end if;
 select * into e from public.events where id=o.event_id;
 if not paid then
   update public.event_table_bookings set state='released' where order_id=o.id and state='held';
   for item in select value from jsonb_array_elements(o.items) loop
     update public.products set available_quantity=available_quantity+(item->>'quantity')::integer where id=(item->>'product_id')::uuid;
   end loop;
   update public.orders set status='cancelled',payment_status='failed' where id=o.id returning * into o;
   update public.guest_checkouts set state='released' where order_id=o.id;
   return o;
 end if;
 update public.orders set status='open',payment_status='paid',payment_reference=session_key where id=o.id returning * into o;
 for item in select value from jsonb_array_elements(o.items) loop
   if item->>'type' = 'table' then
     update public.event_table_bookings set state='confirmed' where order_id=o.id and table_id=(item->>'table_id')::uuid and state='held';
     continue;
   end if;
   qty := (item->>'quantity')::integer; ticket := item->>'type' = 'ticket';
   update public.products set sold_quantity=coalesce(sold_quantity,0)+qty where id=(item->>'product_id')::uuid;
   for i in 1..(case when ticket then qty else 1 end) loop
     insert into public.ticket_receipts(order_id,order_number,buyer_id,owner_id,event_id,video_id,product_id,ticket_type,receipt_kind,ticket_title,quantity,unit_price,total_price,currency,qr_code_data,ticket_image_url,event_name,event_start_date,event_end_date,location_name)
     values(o.id,o.order_number,null,o.business_id,e.id,e.video_id,(item->>'product_id')::uuid,item->>'type',case when ticket then 'ticket' else 'product' end,item->>'name',case when ticket then 1 else qty end,(item->>'price')::numeric,(item->>'price')::numeric*(case when ticket then 1 else qty end),o.currency,(case when ticket then 'TICKET:' else 'PRODUCT:' end)||gen_random_uuid()::text,e.image_url,e.event_name,e.start_date,e.end_date,e.location_name);
   end loop;
 end loop;
 update public.guest_checkouts set state='paid',session_id=session_key where order_id=o.id;
 return o;
end $$;
