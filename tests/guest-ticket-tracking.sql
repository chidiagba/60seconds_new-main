\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values('bc121000-0000-4000-8000-000000000001','tracking-owner@example.test');
insert into profiles(id,email,user_type) values('bc121000-0000-4000-8000-000000000001','tracking-owner@example.test','business');
insert into orders(id,business_id,guest_email,items,subtotal,total_amount,currency,status,payment_status,payment_method) values
 ('bc121000-0000-4000-8000-000000000002','bc121000-0000-4000-8000-000000000001','guest-one@example.test','[]',100,104,'NGN','pending','pending','stripe'),
 ('bc121000-0000-4000-8000-000000000003','bc121000-0000-4000-8000-000000000001','guest-two@example.test','[]',100,104,'NGN','pending','pending','stripe');
insert into guest_checkouts(order_id) values('bc121000-0000-4000-8000-000000000002'),('bc121000-0000-4000-8000-000000000003');
do $$ begin
 if (select count(distinct tracking_code) from guest_checkouts where order_id in ('bc121000-0000-4000-8000-000000000002','bc121000-0000-4000-8000-000000000003'))<>2 then raise exception 'Missing random tracking defaults';end if;
 if exists(select 1 from guest_checkouts where order_id in ('bc121000-0000-4000-8000-000000000002','bc121000-0000-4000-8000-000000000003') and tracking_code::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then raise exception 'Tracking code is not random UUID v4';end if;
end $$;
set local role anon;
do $$ begin
 begin
  if exists(select 1 from guest_checkouts where tracking_code is not null) then raise exception 'TEST FAILED: anon read tracking codes';end if;
 exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','bc121000-0000-4000-8000-000000000001',true);
do $$ begin
 begin
  if exists(select 1 from guest_checkouts where tracking_code is not null) then raise exception 'TEST FAILED: client read tracking codes';end if;
 exception when insufficient_privilege then null;end;
end $$;
rollback;
