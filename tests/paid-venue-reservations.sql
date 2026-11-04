-- Run after paid-venue-fixture.sql in an EMPTY disposable PostgreSQL database.
\set ON_ERROR_STOP on
begin;
insert into auth.users values ('00000000-0000-0000-0000-000000000001','owner@example.com',now()),('00000000-0000-0000-0000-000000000002','buyer@example.com',now());
insert into profiles(id,user_type) values('00000000-0000-0000-0000-000000000001','business');
insert into venue_tables(id,venue_id,name,min_guests,max_guests,deposit_amount,currency,available_from,available_until)
values('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Window table',2,6,50,'CHF',now()+interval '1 day',now()+interval '7 days');
do $$ declare o orders; r table_reservations; failed boolean; begin
 o:=reserve_venue_order('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',now()+interval '2 days',4,'Buyer','buyer@example.com',null);
 if o.total_amount<>52 then raise exception 'Incorrect price'; end if;
 select * into r from table_reservations where order_id=o.id;
 if r.status<>'pending' then raise exception 'Unpaid hold confirmed'; end if;
 failed:=false;
 begin perform reserve_venue_order(r.table_id,r.guest_id,r.starts_at,4,'Buyer','buyer@example.com',null); exception when others then failed:=true; end;
 if not failed then raise exception 'Overlapping booking accepted'; end if;
 failed:=false;
 begin perform reserve_venue_order(r.table_id,r.guest_id,now()+interval '10 days',4,'Buyer','buyer@example.com',null); exception when others then failed:=true; end;
 if not failed then raise exception 'Booking outside business dates accepted'; end if;
 failed:=false;
 begin perform reserve_venue_order(r.table_id,r.guest_id,now()+interval '3 days',7,'Buyer','buyer@example.com',null); exception when others then failed:=true; end;
 if not failed then raise exception 'Oversized party accepted'; end if;
 failed:=false;
 begin perform update_table_reservation_status(r.id,'confirmed'); exception when others then failed:=true; end;
 if not failed then raise exception 'Unpaid hold manually confirmed'; end if;
 update guest_checkouts set session_id='cs_venue_paid' where order_id=o.id;
 failed:=false;
 begin perform finish_guest_order(o.id,true,'wrong_session'); exception when others then failed:=true; end;
 if not failed then raise exception 'Wrong payment session accepted'; end if;
 perform finish_guest_order(o.id,true,'cs_venue_paid');
 perform finish_guest_order(o.id,true,'cs_venue_paid');
 if (select status from table_reservations where id=r.id)<>'confirmed' then raise exception 'Payment did not confirm'; end if;
 o:=reserve_venue_order(r.table_id,r.guest_id,now()+interval '3 days',2,'Buyer','buyer@example.com',null);
 perform finish_guest_order(o.id,false,'');
 if (select status from table_reservations where order_id=o.id)<>'cancelled' then raise exception 'Expired checkout not released'; end if;
 perform reserve_venue_order(r.table_id,r.guest_id,now()+interval '3 days',2,'Buyer','buyer@example.com',null);
end $$;
insert into events(id,business_id,event_name,start_date,end_date,currency) values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Test',now()+interval '1 day',now()+interval '2 days','CHF');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
do $$ declare t event_tables; o orders; failed boolean; begin
 t:=save_event_table('10000000-0000-0000-0000-000000000001',null,'VIP',6,100,true,true);
 o:=reserve_event_order(t.event_id,'buyer@example.com','[]',jsonb_build_array(jsonb_build_object('id',t.id,'quantity',1)));
 if o.total_amount<>104 then raise exception 'Whole-table price must be charged once'; end if;
 if (select seats from event_table_bookings where order_id=o.id)<>6 then raise exception 'Whole table did not hold all seats'; end if;
 if (select available_seats from event_table_inventory(t.event_id))<>0 then raise exception 'Whole table still available'; end if;
 failed:=false;
 begin perform reserve_event_order(t.event_id,'buyer@example.com','[]',jsonb_build_array(jsonb_build_object('id',t.id,'quantity',1))); exception when others then failed:=true; end;
 if not failed then raise exception 'Whole table double booked'; end if;
 perform finish_guest_order(o.id,false,'');
 if (select available_seats from event_table_inventory(t.event_id))<>6 then raise exception 'Whole table hold not released'; end if;
end $$;
set local role authenticated;
do $$ begin
 begin perform reserve_venue_order(null,null,now(),1,'Buyer','buyer@example.com',null); raise exception 'Client created payment hold'; exception when insufficient_privilege then null; end;
end $$;
rollback;
