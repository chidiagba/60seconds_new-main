-- New event tables may be sold as one exclusive table with a fixed guest capacity.
-- Existing per-seat inventory retains its purchase semantics.
alter table public.event_tables add column whole_table boolean not null default false;
alter function public.save_event_table(uuid,uuid,text,integer,numeric,boolean) rename to save_legacy_event_table;
revoke all on function public.save_legacy_event_table(uuid,uuid,text,integer,numeric,boolean) from public,anon,authenticated;
create function public.save_event_table(event_key uuid,table_key uuid,table_name text,seat_count integer,price numeric,active boolean,exclusive boolean default false)
returns public.event_tables language plpgsql security definer set search_path=public as $$
declare t public.event_tables;
begin
 if table_key is not null then perform 1 from public.event_tables where id=table_key for update; end if;
 if table_key is not null and exists(select 1 from public.event_table_bookings where table_id=table_key and state in ('held','confirmed')) and exists(select 1 from public.event_tables where id=table_key and whole_table<>exclusive) then raise exception 'Cannot change booking mode after seats are held or paid'; end if;
 t:=public.save_legacy_event_table(event_key,table_key,table_name,seat_count,price,active);
 update public.event_tables set whole_table=exclusive where id=t.id returning * into t;
 return t;
end $$;
revoke all on function public.save_event_table(uuid,uuid,text,integer,numeric,boolean,boolean) from public;
grant execute on function public.save_event_table(uuid,uuid,text,integer,numeric,boolean,boolean) to authenticated;
drop function public.event_table_inventory(uuid);
create function public.event_table_inventory(event_key uuid) returns table(id uuid,name text,seats integer,seat_price numeric,available_seats bigint,whole_table boolean)
language sql stable security definer set search_path=public as $$
 select t.id,t.name,t.seats,t.seat_price,t.seats-coalesce((select sum(b.seats) from public.event_table_bookings b where b.table_id=t.id and b.state in ('held','confirmed')),0),t.whole_table
 from public.event_tables t where t.event_id=event_key and t.is_active;
$$;
revoke all on function public.event_table_inventory(uuid) from public,anon,authenticated;
grant execute on function public.event_table_inventory(uuid) to service_role;
create or replace function public.reserve_event_order(event_key uuid,buyer_email text,requested_items jsonb,requested_tables jsonb)
returns public.orders language plpgsql security definer set search_path=public as $$
declare e public.events; o public.orders; t public.event_tables; item jsonb; qty integer; booked integer; allocated integer; digits integer; unit numeric; total numeric; lines jsonb;
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
 if t.whole_table and (qty<>1 or allocated>0) then raise exception 'This table must be booked as one whole table'; end if;
 booked:=case when t.whole_table then t.seats else qty end;
 if t.seats-allocated<booked then raise exception 'Not enough seats available at %',t.name; end if;
 unit:=round(t.seat_price*1.04,digits);
 if unit<=0 then raise exception 'Seat price is too low for this currency'; end if;
 insert into public.event_table_bookings(table_id,event_id,order_id,guest_email,seats,table_name,unit_price,currency)
 values(t.id,e.id,o.id,o.guest_email,booked,t.name,unit*qty/booked,o.currency);
 lines:=lines || jsonb_build_array(jsonb_build_object('table_id',t.id,'name',t.name || case when t.whole_table then ' — whole table' else ' — seat' end,'quantity',qty,'price',unit,'type','table'));
 total:=total+unit*qty;
 end loop;
 update public.orders set items=lines,subtotal=total,total_amount=total where id=o.id returning * into o;
 return o;
end $$;
revoke all on function public.reserve_event_order(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_event_order(uuid,text,jsonb,jsonb) to service_role;

