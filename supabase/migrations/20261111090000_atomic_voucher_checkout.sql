-- Checkout prices, reservations, voucher usage and entitlements are one database workflow.
alter table public.vouchers add column if not exists event_id uuid references public.events(id);
alter table public.vouchers add column if not exists allowed_user_ids uuid[];
alter table public.vouchers add column if not exists per_user_limit integer check(per_user_limit > 0);
alter table public.orders add column if not exists platform_fee numeric default 0;
alter table public.orders add column if not exists expires_at timestamptz;
alter table public.voucher_redemptions add column if not exists user_id uuid references public.profiles(id);
alter table public.voucher_redemptions add column if not exists discount_amount numeric;
alter table public.voucher_redemptions add column if not exists status text not null default 'redeemed';
update public.voucher_redemptions r set user_id=o.user_id,discount_amount=coalesce(o.discount_amount,0) from public.orders o where o.id=r.order_id and r.user_id is null;

create table public.checkout_orders (
 order_id uuid primary key references public.orders(id) deferrable initially deferred,
 user_id uuid not null references public.profiles(id), request_key text not null,
 requested_items jsonb not null, quote jsonb not null,
 state text not null default 'reserved' check(state in ('reserved','fulfilled','released')),
 created_at timestamptz not null default now(), fulfilled_at timestamptz,
 unique(user_id,request_key)
);
alter table public.ticket_receipts enable row level security;
create policy checkout_receipts_read on public.ticket_receipts for select to authenticated using(buyer_id=auth.uid() or owner_id=auth.uid());
create policy checkout_receipts_scope on public.ticket_receipts as restrictive for select to authenticated using(buyer_id=auth.uid() or owner_id=auth.uid());
alter table public.checkout_orders enable row level security;
create policy checkout_orders_read on public.checkout_orders for select to authenticated using(user_id=auth.uid());
create policy voucher_redemptions_read on public.voucher_redemptions for select to authenticated
 using(user_id=auth.uid() or exists(select 1 from public.vouchers v where v.id=voucher_id and v.business_id=auth.uid()));
grant select on public.checkout_orders,public.voucher_redemptions,public.orders,public.ticket_receipts,public.vouchers to authenticated;

create or replace function public.quote_order_checkout(requested_items jsonb, voucher_code text default null, buyer_key uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare buyer uuid:=coalesce(auth.uid(),buyer_key); item jsonb; p products%rowtype; e events%rowtype;
 v vouchers%rowtype; owner_key uuid; owner_id uuid; curr text; digits integer; qty integer;
 base numeric:=0; gross numeric:=0; discount numeric:=0; lines jsonb:='[]'; held integer; used integer;
begin
 if buyer is null or (auth.uid() is not null and buyer_key is not null and buyer_key<>auth.uid()) then raise exception 'Authentication required'; end if;
 if auth.uid() is null and coalesce(auth.role(),'')<>'service_role' then raise exception 'Authentication required'; end if;
 if requested_items is null or jsonb_typeof(requested_items)<>'array' or jsonb_array_length(requested_items) not between 1 and 30 then raise exception 'Select 1 to 30 products'; end if;
 if exists(select 1 from jsonb_array_elements(requested_items) i where coalesce(i->>'quantity','') !~ '^[0-9]+$') then raise exception 'Invalid quantity'; end if;
 if nullif(trim(voucher_code),'') is not null then
   select * into v from vouchers where upper(trim(code))=upper(trim(voucher_code));
   if not found then raise exception 'Voucher not found'; end if;
   if not v.is_active then raise exception 'Voucher is inactive'; end if;
   -- Rebuilt schemas use DATE; production uses TIMESTAMPTZ. Preserve both meanings.
   if v.expiry_date is not null then
     if pg_typeof(v.expiry_date)='date'::regtype then
       if v.expiry_date::date < (now() at time zone 'UTC')::date then raise exception 'Voucher has expired'; end if;
     elsif v.expiry_date::timestamptz<=now() then raise exception 'Voucher has expired';
     end if;
   end if;
   if v.allowed_user_ids is not null and not buyer=any(v.allowed_user_ids) then raise exception 'Voucher is not valid for this customer'; end if;
   select count(*) into held from checkout_orders c where c.state='reserved' and c.quote->>'voucher_id'=v.id::text;
   if v.usage_limit is not null and coalesce(v.usage_count,0)+held>=v.usage_limit then raise exception 'Voucher usage limit reached'; end if;
   select count(*) into used from voucher_redemptions r where voucher_id=v.id and user_id=buyer;
   select count(*) into held from checkout_orders c where c.state='reserved' and c.user_id=buyer and c.quote->>'voucher_id'=v.id::text;
   if v.per_user_limit is not null and used+held>=v.per_user_limit then raise exception 'Voucher customer usage limit reached'; end if;
 end if;
 for item in select jsonb_build_object('id',value->>'productId','quantity',sum((value->>'quantity')::integer))
   from jsonb_array_elements(requested_items) group by value->>'productId' order by value->>'productId' loop
   qty:=(item->>'quantity')::integer;
   if qty not between 1 and 100 then raise exception 'Quantity must be between 1 and 100'; end if;
   select * into p from products where id=(item->>'id')::uuid;
   if not found or not coalesce(p.is_active,false) or p.price<0 then raise exception 'Product unavailable'; end if;
   select * into e from events where id=p.event_id;
   if p.event_id is not null and (e.id is null or e.status not in ('open','published') or coalesce(e.end_date,e.start_date)+interval '48 hours'<=now()) then raise exception 'Event is unavailable'; end if;
   owner_key:=coalesce(p.business_id,e.business_id,e.user_id);
   if owner_key is null or (owner_id is not null and owner_id<>owner_key) then raise exception 'Checkout requires one organizer'; end if;
   owner_id:=owner_key;
   if curr is not null and curr<>upper(coalesce(p.currency,e.currency)) then raise exception 'Mixed currencies are not supported'; end if;
   curr:=upper(coalesce(p.currency,e.currency));
   if curr is null or curr !~ '^[A-Z]{3}$' then raise exception 'Product currency is missing'; end if;
   digits:=case when curr in ('BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF') then 0 else 2 end;
   if p.available_quantity is not null and p.available_quantity<qty then raise exception 'Insufficient product availability'; end if;
   if v.id is not null and (v.business_id<>owner_id or (v.product_id is not null and v.product_id<>p.id)
     or (v.event_id is not null and v.event_id is distinct from p.event_id)
     or (coalesce(cardinality(v.applicable_products),0)>0 and not p.id::text=any(v.applicable_products))
     or (coalesce(cardinality(v.applicable_categories),0)>0 and not p.type=any(v.applicable_categories))) then raise exception 'Voucher is not valid for these products or event'; end if;
   base:=base+round(p.price,digits)*qty;
   gross:=gross+round(p.price*1.04,digits)*qty;
   lines:=lines||jsonb_build_array(jsonb_build_object('product_id',p.id,'event_id',p.event_id,'name',p.name,'type',p.type,'quantity',qty,'base_price',p.price,'price',round(p.price*1.04,digits),'currency',curr));
 end loop;
 if v.id is not null then
   if gross<coalesce(v.min_purchase_amount,v.minimum_order_amount,0) then raise exception 'Voucher minimum purchase amount not reached'; end if;
   if (v.discount_type='fixed' or coalesce(v.min_purchase_amount,v.minimum_order_amount,0)>0 or v.max_discount_amount is not null) and upper(v.currency) is distinct from curr then raise exception 'Voucher currency does not match the purchase'; end if;
   discount:=case when v.discount_type='percentage' then round(gross*v.discount_value/100,digits) else v.discount_value end;
   if v.max_discount_amount is not null then discount:=least(discount,v.max_discount_amount); end if;
   if discount is null or discount<0 then raise exception 'Invalid voucher discount'; end if;
   discount:=round(least(gross,discount),digits);
 end if;
 return jsonb_build_object('items',lines,'business_id',owner_id,'currency',curr,'original_subtotal',base,
   'markup_amount',gross-base,'subtotal',gross,'discount_amount',discount,'total_amount',gross-discount,
   'voucher_id',v.id,'voucher_code',v.code,'voucher',case when v.id is null then null else to_jsonb(v) end);
end $$;

-- Legacy clients still receive server validation; only the private checkout record bypasses re-quoting its own hold.
create or replace function public.validate_order_voucher() returns trigger language plpgsql security definer set search_path=public as $$
declare code_value text; q jsonb;
begin
 if exists(select 1 from checkout_orders where order_id=new.id) then return new; end if;
 new.voucher_id:=coalesce(new.voucher_id,nullif(new.payment_metadata->>'voucher_id','')::uuid);
 code_value:=trim(substring(new.notes from 'Voucher applied: ([^[:space:]]+)'));
 if new.voucher_id is not null then select code into code_value from vouchers where id=new.voucher_id; end if;
 if new.voucher_id is null and nullif(code_value,'') is null then return new; end if;
 q:=quote_order_checkout((select jsonb_agg(jsonb_build_object('productId',i->>'product_id','quantity',i->'quantity')) from jsonb_array_elements(new.items) i),code_value,new.user_id);
 if abs(new.total_amount-(q->>'total_amount')::numeric)>0.001 then raise exception 'Voucher total changed. Reapply the voucher before paying'; end if;
 new.voucher_id:=(q->>'voucher_id')::uuid; new.discount_amount:=(q->>'discount_amount')::numeric;
 return new;
end $$;

create or replace function public.fulfill_checkout_order(order_key uuid) returns void
language plpgsql security definer set search_path=public as $$
declare o orders%rowtype; c checkout_orders%rowtype; v vouchers%rowtype; item jsonb; e events%rowtype; qty integer; i integer; ticket boolean;
begin
 select * into o from orders where id=order_key for update;
 select * into c from checkout_orders where order_id=order_key for update;
 if not found or c.state='fulfilled' then return; end if;
 if c.state<>'reserved' or o.payment_status<>'paid' then raise exception 'Order is not ready for fulfillment'; end if;
 if exists(select 1 from ticket_receipts where order_id=o.id) then raise exception 'Unexpected existing entitlements; reconciliation required'; end if;
 if o.voucher_id is not null then
   select * into v from vouchers where id=o.voucher_id for update;
   if v.usage_limit is not null and coalesce(v.usage_count,0)>=v.usage_limit then raise exception 'Voucher usage limit reached'; end if;
   insert into voucher_redemptions(order_id,voucher_id,user_id,discount_amount) values(o.id,o.voucher_id,o.user_id,o.discount_amount);
   update vouchers set usage_count=coalesce(usage_count,0)+1 where id=v.id;
 end if;
 for item in select value from jsonb_array_elements(o.items) order by value->>'product_id' loop
   qty:=(item->>'quantity')::integer; ticket:=item->>'type'='ticket';
   select * into e from events where id=(item->>'event_id')::uuid;
   update products set sold_quantity=coalesce(sold_quantity,0)+qty where id=(item->>'product_id')::uuid;
   for i in 1..(case when ticket then qty else 1 end) loop
     insert into ticket_receipts(order_id,order_number,buyer_id,owner_id,event_id,video_id,product_id,ticket_type,receipt_kind,ticket_title,quantity,unit_price,total_price,currency,qr_code_data,ticket_image_url,event_name,event_start_date,event_end_date,location_name)
     values(o.id,o.order_number,o.user_id,o.business_id,e.id,o.video_id,(item->>'product_id')::uuid,item->>'type',case when ticket then 'ticket' else 'product' end,item->>'name',case when ticket then 1 else qty end,(item->>'price')::numeric,(item->>'price')::numeric*(case when ticket then 1 else qty end),o.currency,(case when ticket then 'TICKET:' else 'PRODUCT:' end)||gen_random_uuid()::text,e.image_url,e.event_name,e.start_date,e.end_date,e.location_name);
   end loop;
 end loop;
 update checkout_orders set state='fulfilled',fulfilled_at=now() where order_id=o.id;
 if o.total_amount=0 then
   insert into payments(order_id,user_id,organizer_id,payment_provider,provider_reference,amount,currency,status,net_amount,processing_fee,transaction_id,paid_at,completed_at,metadata)
   values(o.id,o.user_id,o.business_id,'internal',o.payment_reference,0,o.currency,'completed',0,0,o.payment_reference,now(),now(),jsonb_build_object('method','voucher','voucher_id',o.voucher_id))
   on conflict(payment_provider,provider_reference) do nothing;
 end if;
 insert into push_outbox(user_id,title,body,data) values(o.user_id,'Purchase completed','Your tickets and purchase receipts are ready.',jsonb_build_object('kind','order','orderId',o.id));
end $$;

create or replace function public.consume_order_voucher() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.payment_status='paid' and exists(select 1 from checkout_orders where order_id=new.id) then
   perform fulfill_checkout_order(new.id);
 elsif new.payment_status='paid' and new.voucher_id is not null and exists(select 1 from ticket_receipts where order_id=new.id) then
   perform 1 from vouchers where id=new.voucher_id for update;
   insert into voucher_redemptions(order_id,voucher_id,user_id,discount_amount) values(new.id,new.voucher_id,new.user_id,new.discount_amount) on conflict(order_id) do nothing;
   if found then
     update vouchers set usage_count=coalesce(usage_count,0)+1 where id=new.voucher_id and (usage_limit is null or coalesce(usage_count,0)<usage_limit);
     if not found then raise exception 'Voucher usage limit reached'; end if;
   end if;
 end if;
 -- Conservative policy: refunds invalidate entitlements but do not restore a lifetime voucher slot.
 if new.payment_status='refunded' then
   update ticket_receipts set is_active=false where order_id=new.id;
   update voucher_redemptions set status='refunded' where order_id=new.id;
 end if;
 return new;
end $$;

create or replace function public.create_order_checkout(requested_items jsonb,voucher_code text,request_key text,provider text,buyer_key uuid default null)
returns public.orders language plpgsql security definer set search_path=public as $$
declare buyer uuid:=coalesce(auth.uid(),buyer_key); q jsonb; c checkout_orders%rowtype; o orders%rowtype; item jsonb; p products%rowtype; e events%rowtype; qty integer; held integer; issued integer; order_key uuid:=gen_random_uuid(); ref text;
begin
 if buyer is null or (auth.uid() is not null and buyer_key is not null and buyer_key<>auth.uid()) or (auth.uid() is null and coalesce(auth.role(),'')<>'service_role') then raise exception 'Authentication required'; end if;
 if request_key is null or provider is null or length(request_key) not between 8 and 200 or provider not in ('paystack','stripe') then raise exception 'Invalid checkout request'; end if;
 perform pg_advisory_xact_lock(hashtextextended(buyer::text||request_key,0));
 select * into c from checkout_orders x where x.user_id=buyer and x.request_key=create_order_checkout.request_key;
 if found then
   if c.requested_items<>requested_items or coalesce(c.quote->>'voucher_code','')<>upper(trim(coalesce(voucher_code,''))) then raise exception 'Checkout request key was reused for different items'; end if;
   select * into o from orders where id=c.order_id;
   if c.state='released' or o.payment_status not in ('pending','paid') then raise exception 'Checkout ended; start a new checkout'; end if;
   if o.payment_provider<>'voucher' and o.payment_provider<>provider then raise exception 'Checkout payment provider cannot change'; end if;
   return o;
 end if;
 -- Serialize voucher reservations as well as successful redemptions.
 perform 1 from vouchers where upper(trim(code))=upper(trim(voucher_code)) for update;
 q:=quote_order_checkout(requested_items,voucher_code,buyer);
 if provider='paystack' and q->>'currency'<>'NGN' and (q->>'total_amount')::numeric>0 then raise exception 'Use Stripe for non-NGN purchases'; end if;
 -- Lock event capacity and product stock in a consistent order, then recheck stock.
 perform 1 from events where id in(select (i->>'event_id')::uuid from jsonb_array_elements(q->'items') i) order by id for update;
 perform 1 from products where id in(select (i->>'product_id')::uuid from jsonb_array_elements(q->'items') i) order by id for update;
 for item in select value from jsonb_array_elements(q->'items') loop
   qty:=(item->>'quantity')::integer;
   select * into p from products where id=(item->>'product_id')::uuid;
   if not p.is_active or (p.available_quantity is not null and p.available_quantity<qty) or p.price<>(item->>'base_price')::numeric or upper(p.currency)<>item->>'currency' or p.event_id is distinct from (item->>'event_id')::uuid or (p.business_id is not null and p.business_id::text<>q->>'business_id') then raise exception 'Product price or availability changed'; end if;
   update products set available_quantity=available_quantity-qty where id=p.id and available_quantity is not null;
 end loop;
 for e in select * from events where id in(select (i->>'event_id')::uuid from jsonb_array_elements(q->'items') i where i->>'type'='ticket') loop
   select coalesce(sum((i->>'quantity')::integer),0) into qty from jsonb_array_elements(q->'items') i where i->>'type'='ticket' and i->>'event_id'=e.id::text;
   select coalesce(sum((i->>'quantity')::integer),0) into held from checkout_orders x cross join lateral jsonb_array_elements(x.quote->'items') i where x.state='reserved' and i->>'type'='ticket' and i->>'event_id'=e.id::text;
   select count(*) into issued from ticket_receipts where event_id=e.id and receipt_kind='ticket';
   if e.max_attendees is not null and qty+held+issued>e.max_attendees then raise exception 'Event ticket capacity reached'; end if;
 end loop;
 insert into checkout_orders(order_id,user_id,request_key,requested_items,quote) values(order_key,buyer,request_key,requested_items,q);
 ref:=case when (q->>'total_amount')::numeric=0 then 'VOUCHER-' else upper(provider)||'-' end||order_key::text||'-'||gen_random_uuid()::text;
 insert into orders(id,user_id,business_id,event_id,items,subtotal,discount_amount,total_amount,platform_fee,currency,status,payment_status,payment_method,payment_provider,payment_reference,voucher_id,payment_metadata,expires_at)
 values(order_key,buyer,(q->>'business_id')::uuid,(q->'items'->0->>'event_id')::uuid,q->'items',(q->>'subtotal')::numeric,(q->>'discount_amount')::numeric,(q->>'total_amount')::numeric,
   round((q->>'total_amount')::numeric-(q->>'total_amount')::numeric/1.04,2),q->>'currency','pending','pending',case when (q->>'total_amount')::numeric=0 then 'voucher' else provider end,
   case when (q->>'total_amount')::numeric=0 then 'voucher' else provider end,ref,(q->>'voucher_id')::uuid,q||jsonb_build_object('checkout_version','voucher_v2'),now()+interval '30 minutes') returning * into o;
 if o.total_amount=0 then
   update orders set status='completed',payment_status='paid' where id=o.id returning * into o;
 end if;
 return o;
end $$;

-- Only verified gateway code may call this. Matching reference, amount, currency and order snapshot are mandatory.
create or replace function public.finalize_checkout_payment(order_key uuid,provider text,reference text,paid_amount numeric,paid_currency text,transaction_key text)
returns public.orders language plpgsql security definer set search_path=public as $$
declare o orders%rowtype; ow wallets%rowtype; bw wallets%rowtype; net numeric; fee numeric;
begin
 select * into o from orders where id=order_key for update;
 if not found or not exists(select 1 from checkout_orders where order_id=o.id) then raise exception 'Checkout order not found'; end if;
 if provider is distinct from o.payment_provider or reference is distinct from o.payment_reference or paid_amount is distinct from o.total_amount or upper(paid_currency) is distinct from upper(o.currency) or nullif(trim(transaction_key),'') is null then raise exception 'Verified payment does not match checkout'; end if;
 if o.payment_status='paid' then perform fulfill_checkout_order(o.id); return o; end if;
 if o.payment_status<>'pending' then raise exception 'Order requires payment reconciliation'; end if;
 insert into checkout_payment_evidence(order_id,provider,reference,transaction_id,amount,currency)
 values(o.id,provider,reference,transaction_key,paid_amount,upper(paid_currency));
 net:=round(o.total_amount/1.04,2); fee:=o.total_amount-net;
 insert into wallets(user_id,currency,is_active) values(o.business_id,o.currency,true) on conflict(user_id) do update set is_active=true returning * into ow;
 if upper(ow.currency)<>upper(o.currency) then raise exception 'Organizer wallet currency mismatch; payment reconciliation required'; end if;
 insert into wallets(user_id,currency,is_active) values(o.user_id,o.currency,true) on conflict(user_id) do update set is_active=true returning * into bw;
 update wallets set balance=coalesce(balance,0)+net,updated_at=now() where id=ow.id;
 insert into transactions(wallet_id,amount,type,status,description,transaction_fee,metadata) values
 (ow.id,net,'deposit','completed','Order payment received',0,jsonb_build_object('entry','owner_credit','payment_provider',provider,'payment_reference',reference,'payment_transaction_id',transaction_key,'order_id',o.id,'owner_id',o.business_id,'buyer_id',o.user_id,'currency',o.currency,'gross_amount',o.total_amount,'net_amount',net,'platform_fee_amount',fee)),
 (bw.id,-o.total_amount,'payment','completed','Order purchase',fee,jsonb_build_object('entry','buyer_debit','payment_provider',provider,'payment_reference',reference,'payment_transaction_id',transaction_key,'order_id',o.id,'currency',o.currency));
 insert into payments(order_id,user_id,organizer_id,payment_provider,provider_reference,gateway_reference,amount,currency,status,processing_fee,net_amount,transaction_id,paid_at,completed_at)
 values(o.id,o.user_id,o.business_id,provider,reference,reference,o.total_amount,o.currency,'completed',fee,net,transaction_key,now(),now())
 on conflict(payment_provider,provider_reference) do update set status='completed',transaction_id=excluded.transaction_id,paid_at=now(),completed_at=now();

 update orders set payment_status='paid',status='completed',payment_transaction_id=transaction_key,updated_at=now() where id=o.id returning * into o;
 return o;
end $$;

create or replace function public.release_checkout_order(order_key uuid) returns void
language plpgsql security definer set search_path=public as $$
declare c checkout_orders%rowtype; o orders%rowtype; item jsonb;
begin
 select * into o from orders where id=order_key for update;
 select * into c from checkout_orders where order_id=order_key for update;
 if not found or c.state<>'reserved' or o.payment_status='paid' then return; end if;
 perform 1 from vouchers where id=o.voucher_id for update;
 for item in select value from jsonb_array_elements(o.items) order by value->>'product_id' loop
   update products set available_quantity=available_quantity+(item->>'quantity')::integer where id=(item->>'product_id')::uuid and available_quantity is not null;
 end loop;
 update checkout_orders set state='released' where order_id=o.id;
 update orders set status='cancelled',payment_status='failed' where id=o.id;
end $$;

create unique index checkout_reference_unique on orders(payment_provider,payment_reference) where payment_metadata->>'checkout_version'='voucher_v2';
create or replace function public.bind_checkout_reference(order_key uuid, reference text) returns void
language plpgsql security definer set search_path=public as $$
declare o orders;
begin
 select * into o from orders where id=order_key for update;
 if not found or not exists(select 1 from checkout_orders where order_id=o.id) or o.payment_provider<>'stripe' or reference not like 'pi_%' then raise exception 'Invalid checkout reference'; end if;
 if o.payment_reference=reference then return; end if;
 if o.payment_status<>'pending' or o.payment_reference not like 'STRIPE-%' then raise exception 'Checkout already has a payment reference'; end if;
 update orders set payment_reference=reference where id=o.id;
end $$;
revoke all on function public.bind_checkout_reference(uuid,text) from public,anon,authenticated;
grant execute on function public.bind_checkout_reference(uuid,text) to service_role;

-- Old client callbacks may read an already finalized redemption, but cannot consume a voucher independently.
create or replace function public.redeem_paid_voucher(voucher_key uuid) returns public.vouchers
language plpgsql security definer set search_path=public as $$
declare v vouchers;
begin
 if auth.uid() is null or not exists(select 1 from voucher_redemptions r where r.voucher_id=voucher_key and r.user_id=auth.uid()) then raise exception 'Voucher usage is finalized with the order; reconciliation required'; end if;
 select * into v from vouchers where id=voucher_key;return v;
end $$;

revoke insert,update on public.vouchers from authenticated;
grant insert(business_id,creator_id,code,name,title,description,discount_type,discount_value,discount_percentage,discount_amount,minimum_order_amount,maximum_discount_amount,min_purchase_amount,max_discount_amount,currency,usage_limit,expiry_date,is_active,applicable_categories,applicable_products,product_id,event_id,allowed_user_ids,per_user_limit) on public.vouchers to authenticated;
grant update(code,name,title,description,discount_type,discount_value,discount_percentage,discount_amount,minimum_order_amount,maximum_discount_amount,min_purchase_amount,max_discount_amount,currency,usage_limit,expiry_date,is_active,applicable_categories,applicable_products,product_id,event_id,allowed_user_ids,per_user_limit) on public.vouchers to authenticated;

create or replace function public.guard_voucher_capacity() returns trigger language plpgsql security definer set search_path=public as $$
declare held integer;
begin
 if new.usage_limit is distinct from old.usage_limit and new.usage_limit is not null then
   select count(*) into held from checkout_orders where state='reserved' and quote->>'voucher_id'=new.id::text;
   if new.usage_limit<coalesce(old.usage_count,0)+held then raise exception 'Usage limit cannot be lower than consumed and reserved redemptions'; end if;
 end if;
 return new;
end $$;
create trigger guard_voucher_capacity before update on vouchers for each row execute function guard_voucher_capacity();

do $$ declare name text; begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach name in array array['vouchers','voucher_redemptions','orders','ticket_receipts'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=name) then execute format('alter publication supabase_realtime add table public.%I',name); end if;
  end loop;
 end if;
end $$;

-- Counter repair is deliberately excluded: historical consumption needs evidence, not a reset.
revoke all on function public.quote_order_checkout(jsonb,text,uuid),public.create_order_checkout(jsonb,text,text,text,uuid),public.fulfill_checkout_order(uuid),public.finalize_checkout_payment(uuid,text,text,numeric,text,text),public.release_checkout_order(uuid) from public,anon,authenticated;
grant execute on function public.quote_order_checkout(jsonb,text,uuid),public.create_order_checkout(jsonb,text,text,text,uuid) to authenticated,service_role;
grant execute on function public.fulfill_checkout_order(uuid),public.finalize_checkout_payment(uuid,text,text,numeric,text,text),public.release_checkout_order(uuid) to service_role;
notify pgrst,'reload schema';
-- Recovery is limited to snapshots created by the trusted checkout RPC. A legacy
-- pending total or a code supplied later is not evidence of a free purchase.
create or replace function public.recover_zero_checkout_order(order_key uuid) returns public.orders
language plpgsql security definer set search_path=public as $$
declare o orders; c checkout_orders;
begin
 select * into o from orders where id=order_key for update;
 select * into c from checkout_orders where order_id=order_key for update;
 if not found or c.state='released' or o.total_amount<>0 or (c.quote->>'total_amount')::numeric<>0
   or o.payment_provider<>'voucher' or o.payment_reference not like 'VOUCHER-%'
   or o.voucher_id is distinct from (c.quote->>'voucher_id')::uuid
   or exists(select 1 from payments where order_id=o.id and payment_provider in ('stripe','paystack')) then
   raise exception 'Free checkout evidence is missing; manual reconciliation required';
 end if;
 if o.payment_status='paid' then perform fulfill_checkout_order(o.id); return o; end if;
 if o.payment_status<>'pending' then raise exception 'Order requires manual reconciliation'; end if;
 update orders set payment_status='paid',status='completed',updated_at=now() where id=o.id returning * into o;
 return o;
end $$;
revoke all on function public.recover_zero_checkout_order(uuid) from public,anon,authenticated;
grant execute on function public.recover_zero_checkout_order(uuid) to service_role;
