\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email) values('d1000000-0000-0000-0000-000000000001','boundary-owner@example.test'),('d1000000-0000-0000-0000-000000000002','boundary-buyer@example.test');
insert into profiles(id,email,country_code,user_type) values('d1000000-0000-0000-0000-000000000001','boundary-owner@example.test','NG','business'),('d1000000-0000-0000-0000-000000000002','boundary-buyer@example.test','NG','private');
insert into events(id,user_id,business_id,event_name,start_date,end_date,status,currency,is_public) values('d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','Boundary test',now()+interval '1 day',now()+interval '2 days','published','NGN',true);
insert into products(id,business_id,event_id,name,type,price,currency,available_quantity,is_active) values('d3000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001','Ticket','ticket',1000,'NGN',20,true);
insert into orders(id,user_id,business_id,items,subtotal,total_amount,currency,status,payment_status) values('d4000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000001','[]',1000,1040,'NGN','pending','pending');
do $$ begin
 begin update orders set status='completed' where id='d4000000-0000-0000-0000-000000000001';raise exception 'TEST FAILED: unverified completion';
 exception when others then if sqlerrm<>'Verified payment or authorized zero checkout required' then raise; end if;end;
 begin update orders set payment_status='paid',status='open' where id='d4000000-0000-0000-0000-000000000001';raise exception 'TEST FAILED: unverified paid transition';
 exception when others then if sqlerrm<>'Verified payment evidence required; legacy order needs reconciliation' then raise; end if;end;
 begin perform finalize_paystack_ledger('d4000000-0000-0000-0000-000000000001','forged-reference','forged-tx','d1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000002',1040,1000,40,'NGN');raise exception 'TEST FAILED: legacy ledger bypass';
 exception when others then if sqlerrm<>'Verified payment evidence required; legacy order needs reconciliation' then raise;end if;end;
 if (select balance from wallets where user_id='d1000000-0000-0000-0000-000000000001')<>0 then raise exception 'Failed legacy settlement credited money';end if;
 begin insert into ticket_receipts(order_id,order_number,buyer_id,owner_id,ticket_title,quantity,unit_price,total_price,qr_code_data) values('d4000000-0000-0000-0000-000000000001','unpaid','d1000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000001','forged',1,1000,1000,'forged');raise exception 'TEST FAILED: service legacy receipt bypass';
 exception when others then if sqlerrm<>'Receipt requires a paid order' then raise;end if;end;
end $$;
-- A permissive existing policy/grant still cannot bypass the restrictive policy.
grant insert on ticket_receipts to authenticated;
create policy boundary_old_insert on ticket_receipts for insert to authenticated with check(buyer_id=auth.uid());
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000002',true);
do $$ begin
 begin insert into ticket_receipts(order_id,order_number,buyer_id,owner_id,ticket_title,unit_price,total_price,qr_code_data) values('d4000000-0000-0000-0000-000000000001','unpaid',auth.uid(),'d1000000-0000-0000-0000-000000000001','forged',1000,1000,'forged-auth');raise exception 'TEST FAILED: authenticated receipt bypass';
 exception when insufficient_privilege then null;when others then if sqlerrm<>'Receipt requires a paid order' then raise;end if;end;
 if has_function_privilege('authenticated','settle_verified_guest_payment(uuid,text,text,numeric,text,text)','EXECUTE') or has_function_privilege('authenticated','finalize_checkout_payment(uuid,text,text,numeric,text,text)','EXECUTE') then raise exception 'Client settlement privilege';end if;
 begin perform get_verified_order_receipts('d4000000-0000-0000-0000-000000000001');raise exception 'TEST FAILED: unverified generation RPC';
 exception when others then if sqlerrm<>'Verified purchase not found' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
-- Guest session verification commits financial evidence and fulfillment atomically.
do $$ declare o orders;begin
 o:=reserve_guest_order('d2000000-0000-0000-0000-000000000001','guest@example.test','[{"id":"d3000000-0000-0000-0000-000000000001","quantity":1}]');
 update guest_checkouts set session_id='cs_boundary_verified' where order_id=o.id;
 begin perform finish_guest_order(o.id,true,'cs_boundary_verified');raise exception 'TEST FAILED: guest boolean bypass';
 exception when others then if sqlerrm<>'Verified payment evidence required; legacy order needs reconciliation' then raise;end if;end;
 begin perform settle_verified_guest_payment(o.id,'stripe','cs_boundary_verified',1039,'NGN','pi_verified');raise exception 'TEST FAILED: guest amount mismatch';
 exception when others then if sqlerrm<>'Verified guest payment mismatch' then raise;end if;end;
 perform settle_verified_guest_payment(o.id,'stripe','cs_boundary_verified',1040,'NGN','pi_verified');
 perform settle_verified_guest_payment(o.id,'stripe','cs_boundary_verified',1040,'NGN','pi_verified');
 if (select count(*) from ticket_receipts where order_id=o.id)<>1 or (select count(*) from payments where order_id=o.id and status='completed')<>1 or (select count(*) from checkout_payment_evidence where order_id=o.id)<>1 then raise exception 'Guest replay duplicated or omitted state';end if;
 if (select balance from wallets where user_id=o.business_id)<>1000 or (select count(*) from transactions where metadata->>'order_id'=o.id::text and metadata->>'entry'='owner_credit')<>1 then raise exception 'Guest replay duplicated ledger';end if;
 begin insert into ticket_receipts(order_id,order_number,buyer_id,owner_id,ticket_title,product_id,unit_price,total_price,qr_code_data) values(o.id,o.order_number,null,o.business_id,'Duplicate','d3000000-0000-0000-0000-000000000001',1040,1040,'duplicate');raise exception 'TEST FAILED: second service receipt';
 exception when others then if sqlerrm<>'Receipt issuance must run inside verified atomic fulfillment' then raise;end if;end;
end $$;
-- Stripe canonical settlement, including failure after financial writes.
create function public.boundary_injected_receipt_failure() returns trigger language plpgsql as $$ begin raise exception 'injected receipt failure';end $$;
create trigger boundary_injected_receipt_failure before insert on ticket_receipts for each row execute function public.boundary_injected_receipt_failure();
do $$ declare o orders; begin
 o:=create_order_checkout('[{"productId":"d3000000-0000-0000-0000-000000000001","quantity":1}]',null,'boundary-stripe','stripe','d1000000-0000-0000-0000-000000000002');
 perform bind_checkout_reference(o.id,'pi_boundary');
 begin perform finalize_checkout_payment(o.id,'stripe','pi_boundary',1040,'NGN','pi_boundary');raise exception 'TEST FAILED: injected failure ignored';
 exception when others then if sqlerrm<>'injected receipt failure' then raise;end if;end;
 if exists(select 1 from checkout_payment_evidence where order_id=o.id) or exists(select 1 from payments where order_id=o.id and status='completed') or (select payment_status from orders where id=o.id)<>'pending' then raise exception 'Partial canonical settlement escaped rollback';end if;
 if (select balance from wallets where user_id=o.business_id)<>1000 then raise exception 'Failed settlement leaked wallet credit';end if;
end $$;
do $$ declare o orders;begin
 o:=reserve_guest_order('d2000000-0000-0000-0000-000000000001','rollback-guest@example.test','[{"id":"d3000000-0000-0000-0000-000000000001","quantity":1}]');
 update guest_checkouts set session_id='cs_boundary_rollback' where order_id=o.id;
 begin perform settle_verified_guest_payment(o.id,'stripe','cs_boundary_rollback',1040,'NGN','pi_guest_rollback');raise exception 'TEST FAILED: guest receipt failure ignored';
 exception when others then if sqlerrm<>'injected receipt failure' then raise;end if;end;
 if exists(select 1 from checkout_payment_evidence where order_id=o.id) or exists(select 1 from payments where order_id=o.id and status='completed') or (select state from guest_checkouts where order_id=o.id)<>'reserved' or (select balance from wallets where user_id=o.business_id)<>1000 then raise exception 'Guest financial writes escaped rollback';end if;
end $$;
drop trigger boundary_injected_receipt_failure on ticket_receipts;
do $$ declare o orders;begin
 select * into o from orders where payment_reference='pi_boundary';
 perform finalize_checkout_payment(o.id,'stripe','pi_boundary',1040,'NGN','pi_boundary');
 perform finalize_checkout_payment(o.id,'stripe','pi_boundary',1040,'NGN','pi_boundary');
 if (select count(*) from ticket_receipts where order_id=o.id)<>1 or (select count(*) from payments where order_id=o.id and status='completed')<>1 or (select balance from wallets where user_id=o.business_id)<>2000 then raise exception 'Stripe canonical replay inconsistent';end if;
end $$;
rollback;
