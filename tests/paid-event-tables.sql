\set ON_ERROR_STOP on
begin;
insert into auth.users values ('00000000-0000-0000-0000-000000000001','owner@example.com',now()),('00000000-0000-0000-0000-000000000002','buyer@example.com',now()),('00000000-0000-0000-0000-000000000003','other@example.com',now());
insert into profiles values ('00000000-0000-0000-0000-000000000001','business');
insert into events(id,business_id,event_name,start_date,end_date,currency) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Test event',now()+interval '1 day',now()+interval '2 days','CHF');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select public.save_event_table('10000000-0000-0000-0000-000000000001',null,'VIP',4,10,true);
insert into products(event_id,name,price,currency,available_quantity,type) values ('10000000-0000-0000-0000-000000000001','Entry',20,'CHF',3,'ticket');
do $$ declare t uuid; p uuid; o orders; o2 orders; n integer; code text; result record; begin
 select id into t from event_tables;
 select id into p from products;
 -- Mixed cart: price is computed on the server and seats are held, not confirmed.
 o:=reserve_event_order('10000000-0000-0000-0000-000000000001','BUYER@example.com',jsonb_build_array(jsonb_build_object('id',p,'quantity',1)),jsonb_build_array(jsonb_build_object('id',t,'quantity',3)));
 if o.total_amount<>52 then raise exception 'Incorrect total: %',o.total_amount; end if;
 if exists(select 1 from event_table_bookings where state='confirmed') then raise exception 'Unpaid reservation confirmed'; end if;
 begin
 perform reserve_event_order(o.event_id,'other@example.com','[]',jsonb_build_array(jsonb_build_object('id',t,'quantity',2)));
 raise exception 'TEST FAILED: oversold seats';
 exception when others then if sqlerrm='TEST FAILED: oversold seats' then raise; end if; end;
 begin
 perform save_event_table(o.event_id,t,'VIP',2,10,true);
 raise exception 'TEST FAILED: shrank allocated capacity';
 exception when others then if sqlerrm='TEST FAILED: shrank allocated capacity' then raise; end if; end;
 update guest_checkouts set session_id='cs_test_paid' where order_id=o.id;
 begin
 perform finish_guest_order(o.id,true,'cs_wrong');
 raise exception 'TEST FAILED: accepted wrong session';
 exception when others then if sqlerrm='TEST FAILED: accepted wrong session' then raise; end if; end;
 perform finish_guest_order(o.id,true,'cs_test_paid');
 perform finish_guest_order(o.id,true,'cs_test_paid');
 if (select count(*) from event_table_bookings where state='confirmed')<>1 then raise exception 'Confirmation not idempotent'; end if;
 if (select count(*) from ticket_receipts)<>1 then raise exception 'Ticket fulfillment changed'; end if;
 if (select available_quantity from products)<>2 then raise exception 'Wrong stock'; end if;
 -- Every confirmed table booking has a scannable QR; only the owning event business can consume it once.
 if (select count(distinct qr_code) from event_table_bookings where order_id=o.id)<>1 then raise exception 'Paid table booking QR is missing or duplicated'; end if;
 select qr_code into code from event_table_bookings where order_id=o.id and state='confirmed';
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
 begin perform redeem_event_table_booking(code); raise exception 'TEST FAILED: another account checked in the reservation';
 exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 select * into result from redeem_event_table_booking(code);
 if result.receipt_kind<>'reservation' or result.quantity<>3 or result.redeemed_at is null then raise exception 'Table booking check-in did not return its paid pass'; end if;
 begin perform redeem_event_table_booking(code); raise exception 'TEST FAILED: table QR reused';
 exception when others then if sqlerrm='TEST FAILED: table QR reused' then raise; elsif sqlerrm<>'Table reservation has already been checked in' then raise; end if; end;
 -- Table-only checkout release is idempotent and cannot later become paid.
 o2:=reserve_event_order(o.event_id,'buyer@example.com','[]',jsonb_build_array(jsonb_build_object('id',t,'quantity',1)));
 perform finish_guest_order(o2.id,false,'');
 perform finish_guest_order(o2.id,false,'');
 perform finish_guest_order(o2.id,true,'late_session');
 if (select available_seats from event_table_inventory(o.event_id))<>1 then raise exception 'Release failed'; end if;
 if (select count(*) from event_table_bookings where state='confirmed')<>1 then raise exception 'Released booking confirmed'; end if;
 -- Product stock and table holds roll back together when table stock fails.
 begin
 perform reserve_event_order(o.event_id,'other@example.com',jsonb_build_array(jsonb_build_object('id',p,'quantity',1)),jsonb_build_array(jsonb_build_object('id',t,'quantity',2)));
 raise exception 'TEST FAILED: oversized cart accepted';
 exception when others then if sqlerrm='TEST FAILED: oversized cart accepted' then raise; end if; end;
 if (select available_quantity from products)<>2 then raise exception 'Failed checkout consumed stock'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
do $$ begin
 if (select count(*) from event_table_bookings)<>1 then raise exception 'Buyer cannot see paid booking or can see holds'; end if;
 begin
 perform save_event_table('10000000-0000-0000-0000-000000000001',null,'Unauthorized',2,1,true);
 raise exception 'TEST FAILED: buyer managed table';
 exception when others then if sqlerrm='TEST FAILED: buyer managed table' then raise; end if; end;
 begin
 perform finish_guest_order((select order_id from event_table_bookings limit 1),true,'forged');
 raise exception 'TEST FAILED: client confirmed payment';
 exception when insufficient_privilege then null; end;
 begin
 perform create_table_reservation(gen_random_uuid(),now(),1);
 raise exception 'TEST FAILED: legacy unpaid booking accepted';
 exception when others then if sqlerrm='TEST FAILED: legacy unpaid booking accepted' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
do $$ begin if exists(select 1 from event_table_bookings) then raise exception 'Another buyer can see private bookings'; end if; end $$;
reset role;
update auth.users set email_confirmed_at=null where email='buyer@example.com';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
do $$ begin if exists(select 1 from event_table_bookings) then raise exception 'Unverified email can claim bookings'; end if; end $$;
rollback;
