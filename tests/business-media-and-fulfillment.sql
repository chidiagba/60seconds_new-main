-- Run after paid-event-tables-fixture.sql in a disposable database only.
\set ON_ERROR_STOP on
alter table public.events add column description text, add column location_city text, add column updated_at timestamptz default now();
create table public.videos(id uuid primary key default gen_random_uuid(),user_id uuid,business_id uuid,title text,event_name text,description text,video_url text,thumbnail_url text,duration numeric,event_date timestamptz,location_name text,location_city text,status text,watermarked_video_url text);
alter table public.orders add column created_at timestamptz default now(),add column completed_at timestamptz,add column updated_at timestamptz default now(),add column notes text,add column payment_metadata jsonb;
alter table public.ticket_receipts add column is_active boolean default true,add column redeemed_at timestamptz,add column redeemed_by uuid,add column updated_at timestamptz default now();
\ir ../supabase/migrations/20261027120000_business_event_media.sql
\ir ../supabase/migrations/20261004110000_partial_redemption.sql
create table public.vouchers(id uuid primary key default gen_random_uuid(),business_id uuid,code text,discount_type text,is_active boolean default true,expiry_date timestamptz,usage_limit integer,usage_count integer default 0);
alter table public.products add column business_id uuid;
\ir ../supabase/migrations/20261004135000_voucher_schema.sql
\ir ../supabase/migrations/20261004140000_voucher_redemption.sql
begin;
insert into auth.users values ('00000000-0000-0000-0000-000000000011','business@example.test',now()),('00000000-0000-0000-0000-000000000012','private@example.test',now());
insert into profiles values ('00000000-0000-0000-0000-000000000011','business'),('00000000-0000-0000-0000-000000000012','private');
insert into events(id,user_id,business_id,event_name,start_date,end_date,currency,image_url) values('10000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000011','Flyer event',now()+interval '1 day',now()+interval '2 days','CHF','https://example.test/flyer.jpg');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
do $$ declare e events; v uuid; o orders; r record; code1 text; code2 text; voucher_key uuid; begin
 e:=save_event_media('10000000-0000-0000-0000-000000000011','https://example.test/flyer.jpg',null);
 if e.video_id is not null then raise exception 'Flyer-only event requires no video'; end if;
 e:=save_event_media(e.id,e.image_url,'https://example.test/clip.mp4',null,30); v:=e.video_id;
 if v is null then raise exception 'Could not add video to flyer-only event'; end if;
 e:=save_event_media(e.id,e.image_url,'https://example.test/replacement.mp4',null,20);
 if e.video_id<>v or (select video_url from videos where id=v)<>'https://example.test/replacement.mp4' then raise exception 'Replacement video was not saved'; end if;
 e:=save_event_media(e.id,null,'https://example.test/replacement.mp4');
 if e.image_url is not null then raise exception 'Video-only edit failed'; end if;
 e:=save_event_media(e.id,'https://example.test/new-flyer.jpg',null);
 if e.video_id is not null then raise exception 'Flyer-only edit failed'; end if;
 begin perform save_event_media(e.id,null,null); raise exception 'TEST FAILED: empty media accepted'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
 begin perform save_event_media(e.id,e.image_url,'https://example.test/too-long.mp4',null,61); raise exception 'TEST FAILED: long video accepted'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000012',true);
 begin perform save_event_media(e.id,'https://example.test/forged.jpg',null); raise exception 'TEST FAILED: private user edited media'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
 insert into products(id,event_id,business_id,name,price,currency,available_quantity,type) values
 ('20000000-0000-0000-0000-000000000011',e.id,e.user_id,'Entry',10,'CHF',20,'ticket'),('20000000-0000-0000-0000-000000000012',e.id,e.user_id,'Drink',5,'CHF',20,'drink');
 o:=reserve_event_order(e.id,'guest@example.test','[{"id":"20000000-0000-0000-0000-000000000011","quantity":1},{"id":"20000000-0000-0000-0000-000000000012","quantity":1}]','[]');
 perform finish_guest_order(o.id,true,'cs_mixed_test');
 select qr_code_data into code1 from ticket_receipts where order_id=o.id and receipt_kind='ticket';
 select qr_code_data into code2 from ticket_receipts where order_id=o.id and receipt_kind='product';
 if code1 is null or code2 is null or code1=code2 then raise exception 'Ticket/product QR codes not separated'; end if;
 if exists(select 1 from ticket_receipts where order_id=o.id and ticket_image_url is distinct from e.image_url) then raise exception 'Ticket flyer not saved'; end if;
 perform redeem_ticket(code1);
 if (select status from orders where id=o.id)<>'partially_completed' then raise exception 'Missing partially completed status'; end if;
 perform redeem_ticket(code2);
 if (select status from orders where id=o.id)<>'completed' then raise exception 'Missing completed status'; end if;
 begin perform redeem_ticket(code1); raise exception 'TEST FAILED: double redemption'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
 -- Voucher creation/normalization, server-calculated discount and paid usage.
 insert into vouchers(business_id,code,discount_type,discount_value,usage_limit) values(e.user_id,' save25 ','percentage',25,10) returning id into voucher_key;
 if (select code from vouchers where id=voucher_key)<>'SAVE25' then raise exception 'Voucher normalization failed'; end if;
 insert into orders(user_id,business_id,event_id,items,subtotal,total_amount,currency,status,payment_status,notes)
 values('00000000-0000-0000-0000-000000000012',e.user_id,e.id,'[{"product_id":"20000000-0000-0000-0000-000000000011","quantity":1}]',10.4,7.8,'CHF','open','pending','Voucher applied: SAVE25') returning * into o;
 update orders set payment_status='paid' where id=o.id;
 update orders set payment_status='paid' where id=o.id;
 if (select usage_count from vouchers where id=voucher_key)<>1 then raise exception 'Voucher payment retry counted twice'; end if;
 update vouchers set expiry_date=now()-interval '1 hour' where id=voucher_key;
 begin
 insert into orders(user_id,items,total_amount,payment_status,notes) values(e.user_id,'[{"product_id":"20000000-0000-0000-0000-000000000011","quantity":1}]',7.8,'pending','Voucher applied: SAVE25');
 raise exception 'TEST FAILED: expired voucher accepted'; exception when others then if sqlerrm like 'TEST FAILED:%' then raise; end if; end;
end $$;
rollback;
