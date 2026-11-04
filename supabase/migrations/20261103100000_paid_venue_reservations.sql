-- Reuse guest checkout holds, verified webhooks and reconciliation for profile bookings.
alter table public.venue_tables add column available_from timestamptz,
 add column available_until timestamptz,
 add constraint venue_table_dates check (available_until is null or available_from is null or available_until > available_from);
alter table public.table_reservations add column order_id uuid unique references public.orders(id),
 add column guest_name text, add column guest_email text,
 add column table_name text, add column paid_amount numeric, add column currency text;

create function public.reserve_venue_order(table_key uuid, guest_key uuid, arrival timestamptz, party integer, buyer_name text, buyer_email text, note text)
returns public.orders language plpgsql security definer set search_path=public as $$
declare t public.venue_tables; o public.orders; amount numeric; digits integer;
begin
 select * into t from public.venue_tables where id=table_key and is_active for update;
 if not found then raise exception 'Table unavailable'; end if;
 if guest_key is null or not exists(select 1 from auth.users where id=guest_key) then raise exception 'Sign in to book'; end if;
 if arrival is null or arrival <= now() or party is null or party not between t.min_guests and t.max_guests then raise exception 'Invalid arrival or guest count'; end if;
 if (t.available_from is not null and arrival < t.available_from) or (t.available_until is not null and arrival + make_interval(mins=>t.booking_duration_minutes) > t.available_until) then raise exception 'Outside the table booking dates'; end if;
 if buyer_name is null or length(trim(buyer_name)) not between 1 and 120 or buyer_email is null or length(buyer_email)>254 or trim(buyer_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter your name and a valid email'; end if;
 if length(note)>500 then raise exception 'Note is too long'; end if;
 digits:=case when upper(t.currency) in ('BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF') then 0 else 2 end;
 amount:=round(coalesce(nullif(t.deposit_amount,0),t.minimum_spend,0)*1.04,digits);
 if amount <= 0 or amount='NaN'::numeric then raise exception 'The business must set a positive booking deposit or price'; end if;
 insert into public.orders(user_id,business_id,guest_email,items,subtotal,total_amount,currency,status,payment_status,payment_method)
 values(guest_key,t.venue_id,lower(trim(buyer_email)),jsonb_build_array(jsonb_build_object('name',t.name || ' — ' || arrival::text,'type','table','quantity',1,'price',amount)),amount,amount,upper(t.currency),'pending','pending','stripe') returning * into o;
 insert into public.guest_checkouts(order_id) values(o.id);
 insert into public.table_reservations(table_id,venue_id,guest_id,party_size,starts_at,ends_at,status,guest_note,order_id,guest_name,guest_email,table_name,paid_amount,currency)
 values(t.id,t.venue_id,guest_key,party,arrival,arrival+make_interval(mins=>t.booking_duration_minutes),'pending',nullif(trim(note),''),o.id,trim(buyer_name),o.guest_email,t.name,amount,o.currency);
 return o;
exception when exclusion_violation then raise exception 'This table was just booked for that time. Choose another time.';
end $$;
revoke all on function public.reserve_venue_order(uuid,uuid,timestamptz,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_venue_order(uuid,uuid,timestamptz,integer,text,text,text) to service_role;

-- The existing fulfillment function locks orders and validates the checkout session.
-- Its transaction changes venue holds only when the checkout changes state.
create function public.settle_venue_checkout() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.state is distinct from old.state then
  update public.table_reservations set status=case when new.state='paid' then 'confirmed'::public.reservation_status else 'cancelled'::public.reservation_status end
  where order_id=new.order_id and status='pending' and new.state in ('paid','released');
 end if;
 return new;
end $$;
create trigger settle_venue_checkout after update of state on public.guest_checkouts for each row execute function public.settle_venue_checkout();

-- Neither guests nor managers may confirm an unpaid hold or discard a paid order.
alter function public.update_table_reservation_status(uuid,public.reservation_status,text) rename to update_legacy_table_reservation_status;
revoke all on function public.update_legacy_table_reservation_status(uuid,public.reservation_status,text) from public,anon,authenticated;
create function public.update_table_reservation_status(p_reservation_id uuid,p_status public.reservation_status,p_business_note text default null)
returns public.table_reservations language plpgsql security definer set search_path=public as $$
declare r public.table_reservations;
begin
 select * into r from public.table_reservations where id=p_reservation_id for update;
 if r.order_id is not null and (r.status='pending' or p_status in ('cancelled','declined')) then
 raise exception 'Payment holds are settled by checkout. Contact the venue for paid booking cancellations and refunds.';
 end if;
 return public.update_legacy_table_reservation_status(p_reservation_id,p_status,p_business_note);
end $$;
revoke all on function public.update_table_reservation_status(uuid,public.reservation_status,text) from public;
grant execute on function public.update_table_reservation_status(uuid,public.reservation_status,text) to authenticated;

-- Keep paid reservation snapshots and outstanding checkout holds when hiding tables.
create function public.protect_paid_venue_table() returns trigger language plpgsql set search_path=public as $$
begin
 if exists(select 1 from public.table_reservations where table_id=old.id and order_id is not null) then
  raise exception 'Hide this table to preserve its payment and reservation history';
 end if;
 return old;
end $$;
create trigger protect_paid_venue_table before delete on public.venue_tables for each row execute function public.protect_paid_venue_table();
