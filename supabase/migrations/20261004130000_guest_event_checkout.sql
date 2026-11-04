-- Guests have no auth/profile row. Access to their order is never granted to anon.
alter table public.orders alter column user_id drop not null;
alter table public.ticket_receipts alter column buyer_id drop not null;
alter table public.orders add column if not exists guest_email text;
create table public.guest_checkouts (
 order_id uuid primary key references public.orders(id), session_id text unique,
 state text not null default 'reserved' check(state in ('reserved','paid','released')),
 email_sent_at timestamptz, created_at timestamptz not null default now()
);
alter table public.guest_checkouts enable row level security;

create or replace function public.reserve_guest_order(event_key uuid, buyer_email text, requested_items jsonb)
returns public.orders language plpgsql security definer set search_path = public as $$
declare e public.events%rowtype; p public.products%rowtype; o public.orders%rowtype;
 item jsonb; qty integer; digits integer; total numeric := 0; lines jsonb := '[]';
begin
 select * into e from public.events where id=event_key and is_public and status in ('open','published');
 if not found or now() >= coalesce(e.end_date,e.start_date) + interval '48 hours' then raise exception 'Event link has expired or is unavailable'; end if;
 if buyer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(buyer_email)>254 then raise exception 'Enter a valid email address'; end if;
 if requested_items is null or jsonb_typeof(requested_items) <> 'array' or jsonb_array_length(requested_items) not between 1 and 30 then raise exception 'Select 1 to 30 products'; end if;
 digits := case when upper(e.currency) in ('BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF') then 0 else 2 end;
 -- Aggregate duplicates and lock products in a consistent order.
 for item in select jsonb_build_object('id',value->>'id','quantity',sum((value->>'quantity')::integer)) from jsonb_array_elements(requested_items) group by value->>'id' order by value->>'id' loop
   qty := (item->>'quantity')::integer;
   if qty is null or qty not between 1 and 20 then raise exception 'Quantity must be between 1 and 20'; end if;
   select * into p from public.products where id=(item->>'id')::uuid and event_id=e.id and is_active for update;
   if not found or p.price <= 0 or p.available_quantity is null or p.available_quantity < qty then raise exception 'Product unavailable or insufficient stock'; end if;
   if upper(coalesce(p.currency,e.currency)) <> upper(e.currency) then raise exception 'Mixed currencies are not supported'; end if;
   update public.products set available_quantity=available_quantity-qty where id=p.id;
   total := total + round(p.price * 1.04,digits) * qty;
   lines := lines || jsonb_build_array(jsonb_build_object('product_id',p.id,'name',p.name,'quantity',qty,'price',round(p.price*1.04,digits),'type',p.type));
 end loop;
 insert into public.orders(user_id,business_id,event_id,video_id,guest_email,items,subtotal,total_amount,currency,status,payment_status,payment_method)
 values(null,coalesce(e.business_id,e.user_id),e.id,e.video_id,lower(trim(buyer_email)),lines,total,total,upper(e.currency),'pending','pending','stripe') returning * into o;
 insert into public.guest_checkouts(order_id) values(o.id);
 return o;
end $$;

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
   for item in select value from jsonb_array_elements(o.items) loop
     update public.products set available_quantity=available_quantity+(item->>'quantity')::integer where id=(item->>'product_id')::uuid;
   end loop;
   update public.orders set status='cancelled',payment_status='failed' where id=o.id returning * into o;
   update public.guest_checkouts set state='released' where order_id=o.id;
   return o;
 end if;
 update public.orders set status='open',payment_status='paid',payment_reference=session_key where id=o.id returning * into o;
 for item in select value from jsonb_array_elements(o.items) loop
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
revoke all on function public.reserve_guest_order(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.finish_guest_order(uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.reserve_guest_order(uuid,text,jsonb) to service_role;
grant execute on function public.finish_guest_order(uuid,boolean,text) to service_role;
