\set ON_ERROR_STOP on
begin;
\ir ../supabase/migrations/20261116170000_web_checkout_attempts.sql
insert into auth.users values ('00000000-0000-0000-0000-000000000001','owner@example.com',now());
insert into profiles values ('00000000-0000-0000-0000-000000000001','business');
insert into events(id,business_id,event_name,start_date,end_date,currency) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Web test',now()+interval '1 day',now()+interval '2 days','NGN');
insert into products(id,event_id,name,price,currency,available_quantity,type) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Entry',1000,'NGN',10,'ticket');
insert into event_tables(id,event_id,name,seats,seat_price,is_active,whole_table) values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','VIP',4,2000,true,false);
do $$ declare first jsonb; second jsonb; oid uuid; begin
 first:=reserve_web_event_checkout('10000000-0000-0000-0000-000000000001','BUYER@example.com','[{"id":"20000000-0000-0000-0000-000000000001","quantity":1}]','[{"id":"30000000-0000-0000-0000-000000000001","quantity":2}]','40000000-0000-4000-8000-000000000001','NG','paystack_transfer');
 oid:=(first->'order'->>'id')::uuid;
 if (first->'order'->>'total_amount')::numeric<>5200 or not(first->>'fresh')::boolean then raise exception 'Invalid server quote'; end if;
 second:=reserve_web_event_checkout('10000000-0000-0000-0000-000000000001','buyer@example.com','[{"id":"20000000-0000-0000-0000-000000000001","quantity":1}]','[{"id":"30000000-0000-0000-0000-000000000001","quantity":2}]','40000000-0000-4000-8000-000000000001','NG','paystack_transfer');
 if (second->>'fresh')::boolean or second->'order'->>'id'<>oid::text then raise exception 'Retry created another order'; end if;
 if (select available_quantity from products limit 1)<>9 or (select sum(seats) from event_table_bookings where state='held')<>2 then raise exception 'Retry consumed inventory twice'; end if;
 begin
 perform reserve_web_event_checkout('10000000-0000-0000-0000-000000000001','buyer@example.com','[{"id":"20000000-0000-0000-0000-000000000001","quantity":1}]','[{"id":"30000000-0000-0000-0000-000000000001","quantity":2}]','40000000-0000-4000-8000-000000000001','OTHER','stripe_card');
 raise exception 'TEST FAILED changed provider accepted';
 exception when others then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
 if exists(select 1 from ticket_receipts) or exists(select 1 from orders where payment_status='paid') or exists(select 1 from event_table_bookings where state='confirmed') then raise exception 'Unpaid purchase fulfilled'; end if;
 if has_table_privilege('anon','public.web_checkout_attempts','select') or has_table_privilege('authenticated','public.web_checkout_attempts','update') then raise exception 'Attempt privacy broken'; end if;
 if has_function_privilege('anon','public.reserve_web_event_checkout(uuid,text,jsonb,jsonb,uuid,text,text)','execute') then raise exception 'Anon can reserve directly'; end if;
end $$;
rollback;
