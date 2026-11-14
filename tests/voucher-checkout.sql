\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email) values('a1000000-0000-0000-0000-000000000001','voucher-owner@example.test'),('a1000000-0000-0000-0000-000000000002','voucher-buyer@example.test'),('a1000000-0000-0000-0000-000000000003','other-buyer@example.test');
insert into profiles(id,email,user_type,country_code) select id,email,'business','NG' from auth.users where id::text like 'a1000000%';
insert into events(id,user_id,business_id,event_name,start_date,end_date,status,currency,max_attendees) values('a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','Voucher test',now()+interval '1 day',now()+interval '2 days','published','NGN',100);
insert into products(id,business_id,event_id,name,type,price,currency,available_quantity,is_active) values('a3000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','Ticket','ticket',1000,'NGN',100,true);
insert into vouchers(business_id,code,name,discount_type,discount_value,usage_limit,currency) values('a1000000-0000-0000-0000-000000000001','HJSDGUBY','Free voucher','percentage',100,100,'NGN'),('a1000000-0000-0000-0000-000000000001','HALF','Half voucher','percentage',50,100,'NGN');
insert into events(id,user_id,business_id,event_name,start_date,end_date,status,currency) values('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','Other voucher event',now()+interval '1 day',now()+interval '2 days','published','NGN');
do $$ declare q jsonb; attempt jsonb; o orders; again orders; v vouchers; lines jsonb:='[{"productId":"a3000000-0000-0000-0000-000000000001","quantity":1}]'; begin
 q:=quote_order_checkout(lines,' hjsdguby ','a1000000-0000-0000-0000-000000000002');
 if (q->>'original_subtotal')::numeric<>1000 or (q->>'markup_amount')::numeric<>40 or (q->>'discount_amount')::numeric<>1040 or (q->>'total_amount')::numeric<>0 then raise exception 'Wrong authoritative full-discount quote %',q; end if;
 o:=create_order_checkout(lines,'hjsdguby','free-request-1','paystack','a1000000-0000-0000-0000-000000000002');
 if o.payment_status<>'paid' or o.status not in ('open','completed') or o.payment_method<>'voucher' or o.total_amount<>0 or o.payment_reference not like 'VOUCHER-%' then raise exception 'Zero payment not completed %',row_to_json(o); end if;
 if (select count(*) from ticket_receipts where order_id=o.id and buyer_id=o.user_id)<>1 then raise exception 'Zero order ticket missing'; end if;
 if (select usage_count from vouchers where id=o.voucher_id)<>1 then raise exception 'Usage was not consumed'; end if;
 again:=create_order_checkout(lines,'HJSDGUBY','free-request-1','paystack',o.user_id);
 if again.id<>o.id or (select count(*) from ticket_receipts where order_id=o.id)<>1 or (select usage_count from vouchers where id=o.voucher_id)<>1 then raise exception 'Repeated confirmation duplicated fulfillment'; end if;
 o:=create_order_checkout(lines,'HALF','half-request-1','paystack',o.user_id);
 if o.total_amount<>520 or o.payment_status<>'pending' or exists(select 1 from ticket_receipts where order_id=o.id) or (select usage_count from vouchers where id=o.voucher_id)<>0 then raise exception 'Partial payment counted early'; end if;
 perform set_config('request.jwt.claim.sub',o.user_id::text,true);
 attempt:=get_checkout_attempt('half-request-1');
 if attempt is null or attempt->>'order_id'<>o.id::text or attempt->>'state'<>'reserved' or (attempt->'quote'->>'total_amount')::numeric<>520 then raise exception 'Authenticated checkout resume RPC returned the wrong hold'; end if;
 perform set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000003',true);
 if get_checkout_attempt('half-request-1') is not null then raise exception 'Another buyer can read this checkout hold'; end if;
 perform set_config('request.jwt.claim.sub',o.user_id::text,true);
 begin perform finalize_checkout_payment(o.id,'paystack',o.payment_reference,519,'NGN','bad-amount'); raise exception 'TEST FAILED: amount mismatch'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
 begin perform create_order_checkout(lines,'HALF','half-request-1','stripe',o.user_id); raise exception 'TEST FAILED: retry switched provider'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
 perform finalize_checkout_payment(o.id,'paystack',o.payment_reference,520,'NGN','verified-1');
 perform finalize_checkout_payment(o.id,'paystack',o.payment_reference,520,'NGN','verified-1');
 if (select count(*) from ticket_receipts where order_id=o.id)<>1 or (select usage_count from vouchers where id=o.voucher_id)<>1 then raise exception 'Verified payment replay duplicated fulfillment'; end if;
 if (select count(*) from transactions where metadata->>'order_id'=o.id::text)<>2 or (select balance from wallets where user_id=o.business_id)<>500 then raise exception 'Duplicate or incorrect ledger settlement'; end if;
 o:=create_order_checkout(lines,'HALF','failed-request-1','stripe',o.user_id);
 perform release_checkout_order(o.id); perform release_checkout_order(o.id);
 begin perform create_order_checkout(lines,'HALF','failed-request-1','stripe',o.user_id); raise exception 'TEST FAILED: released checkout reused'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
 if exists(select 1 from voucher_redemptions where order_id=o.id) or exists(select 1 from ticket_receipts where order_id=o.id) then raise exception 'Failed payment consumed voucher'; end if;
 o:=create_order_checkout('[{"productId":"a3000000-0000-0000-0000-000000000001","quantity":3}]','HJSDGUBY','multi-request-1','stripe',o.user_id);
 if (select count(*) from ticket_receipts where order_id=o.id)<>3 or (select count(distinct qr_code_data) from ticket_receipts where order_id=o.id)<>3 then raise exception 'Multi-ticket fulfillment failed'; end if;
 -- Recovery must be idempotent and require a trusted free snapshot.
 again:=recover_zero_checkout_order(o.id);
 perform recover_zero_checkout_order(o.id);
 if (select count(*) from ticket_receipts where order_id=o.id)<>3 then raise exception 'Recovery duplicated tickets'; end if;
 begin perform recover_zero_checkout_order(gen_random_uuid()); raise exception 'TEST FAILED: missing recovery evidence'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
 -- All eligibility cases execute the real quote, never a frontend calculator.
 for v in select * from vouchers where code='HALF' loop
   update vouchers set is_active=false where id=v.id;
   begin perform quote_order_checkout(lines,'HALF',o.user_id); raise exception 'TEST FAILED: inactive'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
   update vouchers set is_active=true,expiry_date=(now() at time zone 'UTC')::date-1 where id=v.id;
   begin perform quote_order_checkout(lines,'HALF',o.user_id); raise exception 'TEST FAILED: expired'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
   update vouchers set expiry_date=null,usage_limit=1 where id=v.id;
   begin perform quote_order_checkout(lines,'HALF',o.user_id); raise exception 'TEST FAILED: exhausted'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
   update vouchers set usage_limit=100,allowed_user_ids=array['a1000000-0000-0000-0000-000000000003'::uuid] where id=v.id;
   begin perform quote_order_checkout(lines,'HALF',o.user_id); raise exception 'TEST FAILED: wrong customer'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
   update vouchers set allowed_user_ids=null,per_user_limit=1 where id=v.id;
   begin perform quote_order_checkout(lines,'HALF',o.user_id); raise exception 'TEST FAILED: per-user limit'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
   update vouchers set per_user_limit=null,min_purchase_amount=2000 where id=v.id;
   begin perform quote_order_checkout(lines,'HALF',o.user_id); raise exception 'TEST FAILED: minimum'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
   update vouchers set min_purchase_amount=null,applicable_products=array[gen_random_uuid()::text] where id=v.id;
   begin perform quote_order_checkout(lines,'HALF',o.user_id); raise exception 'TEST FAILED: event'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
   update vouchers set applicable_products=null,event_id='a2000000-0000-0000-0000-000000000002' where id=v.id;
   begin perform quote_order_checkout(lines,'HALF',o.user_id); raise exception 'TEST FAILED: event restriction'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
   update vouchers set event_id=null,discount_type='fixed',discount_value=300,currency='NGN' where id=v.id;
   q:=quote_order_checkout(lines,'HALF',o.user_id);
   if (q->>'total_amount')::numeric<>740 then raise exception 'Fixed discount amount is incorrect'; end if;
   update vouchers set currency='USD' where id=v.id;
   begin perform quote_order_checkout(lines,'HALF',o.user_id); raise exception 'TEST FAILED: currency restriction'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
   update vouchers set currency='NGN',discount_type='percentage',discount_value=100,max_discount_amount=100 where id=v.id;
   q:=quote_order_checkout(lines,'HALF',o.user_id);
   if (q->>'total_amount')::numeric<>940 then raise exception 'Maximum discount cap is incorrect'; end if;
   update vouchers set max_discount_amount=null,applicable_categories=array['drink'] where id=v.id;
   begin perform quote_order_checkout(lines,'HALF',o.user_id); raise exception 'TEST FAILED: category'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
 end loop;
 begin perform quote_order_checkout(lines,'INVALID',o.user_id); raise exception 'TEST FAILED: invalid'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
end $$;

-- Production uses timestamp expiry rather than the rebuilt schema's DATE.
update vouchers set expiry_date=(now() at time zone 'UTC')::date where code='HJSDGUBY';
do $$ begin
 if (select atttypid='date'::regtype from pg_attribute where attrelid='vouchers'::regclass and attname='expiry_date') then
 perform quote_order_checkout('[{"productId":"a3000000-0000-0000-0000-000000000001","quantity":1}]','HJSDGUBY','a1000000-0000-0000-0000-000000000002');
 end if;
end $$;
alter table vouchers alter column expiry_date type timestamptz using expiry_date::timestamp at time zone 'UTC';
-- Recompile against this alternate schema, as a migration would in production.
-- PL/pgSQL session plans compiled against DATE cannot be reused after test-only DDL.
select pg_get_functiondef('public.quote_order_checkout(jsonb,text,uuid)'::regprocedure) \gexec
update vouchers set expiry_date=now()-interval '1 second' where code='HJSDGUBY';
do $$ begin
 begin perform quote_order_checkout('[{"productId":"a3000000-0000-0000-0000-000000000001","quantity":1}]','HJSDGUBY','a1000000-0000-0000-0000-000000000002');
 raise exception 'TEST FAILED: timestamp expiry extended to midnight';
 exception when others then if sqlerrm<>'Voucher has expired' then raise; end if; end;
end $$;
update vouchers set expiry_date=now()+interval '1 hour' where code='HJSDGUBY';

-- Read through the same RLS-protected tables used by customer and owner screens.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000002',true);
do $$ begin
 if (select count(*) from ticket_receipts where buyer_id=auth.uid())<>5 then raise exception 'Customer ticket list cannot read fulfilled entitlements'; end if;
 if (select count(*) from orders where user_id=auth.uid() and payment_status='paid')<>3 then raise exception 'Order history disagrees with fulfillment'; end if;
end $$;
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000003',true);
do $$ begin
 if exists(select 1 from ticket_receipts where buyer_id='a1000000-0000-0000-0000-000000000002') then raise exception 'Another customer can read tickets'; end if;
end $$;
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000001',true);
do $$ begin
 if (select usage_count from vouchers where code='HJSDGUBY')<>2 then raise exception 'Owner voucher view has stale consumption'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','service_role',true);

-- Simulate an interrupted trusted checkout; legacy orders without this snapshot
-- remain ineligible for automatic recovery.
alter table orders disable trigger consume_order_voucher;
do $$ declare o orders; begin
 o:=create_order_checkout('[{"productId":"a3000000-0000-0000-0000-000000000001","quantity":1}]','HJSDGUBY','stuck-free-request','stripe','a1000000-0000-0000-0000-000000000002');
 update orders set payment_status='pending',status='pending' where id=o.id;
end $$;
alter table orders enable trigger consume_order_voucher;
do $$ declare o orders; begin
 select orders.* into o from orders join checkout_orders c on c.order_id=orders.id where c.request_key='stuck-free-request';
 perform recover_zero_checkout_order(o.id); perform recover_zero_checkout_order(o.id);
 if (select payment_status from orders where id=o.id)<>'paid' or (select count(*) from ticket_receipts where order_id=o.id)<>1 or (select count(*) from voucher_redemptions where order_id=o.id)<>1 then raise exception 'Stuck checkout recovery failed'; end if;
 if has_column_privilege('authenticated','public.vouchers','usage_count','UPDATE') or has_function_privilege('authenticated','public.finalize_checkout_payment(uuid,text,text,numeric,text,text)','EXECUTE') then raise exception 'Client has settlement privileges'; end if;
end $$;
-- Failure during ticket insertion rolls back order, stock and usage together.
create function public.test_checkout_receipt_failure() returns trigger language plpgsql as $$ begin raise exception 'Injected receipt failure'; end $$;
create trigger test_checkout_receipt_failure before insert on ticket_receipts for each row execute function public.test_checkout_receipt_failure();
do $$ declare stock integer; used integer; begin
 select available_quantity into stock from products where id='a3000000-0000-0000-0000-000000000001';
 select usage_count into used from vouchers where code='HJSDGUBY';
 begin
  perform create_order_checkout('[{"productId":"a3000000-0000-0000-0000-000000000001","quantity":1}]','HJSDGUBY','rollback-free-request','stripe','a1000000-0000-0000-0000-000000000002');
  raise exception 'TEST FAILED: fulfillment should fail';
 exception when others then if sqlerrm<>'Injected receipt failure' then raise; end if; end;
 if exists(select 1 from checkout_orders where request_key='rollback-free-request') or stock<>(select available_quantity from products where id='a3000000-0000-0000-0000-000000000001') or used<>(select usage_count from vouchers where code='HJSDGUBY') then raise exception 'Partial free checkout escaped rollback'; end if;
end $$;
drop trigger test_checkout_receipt_failure on ticket_receipts;
drop function public.test_checkout_receipt_failure();
rollback;
