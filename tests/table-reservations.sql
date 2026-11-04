-- Run after the migration in an isolated database with Supabase auth/storage fixtures.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'), ('00000000-0000-0000-0000-000000000003');
insert into public.profiles(id,user_type,business_name) values ('00000000-0000-0000-0000-000000000001','business','Test club'), ('00000000-0000-0000-0000-000000000002','private',null), ('00000000-0000-0000-0000-000000000003','private',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
insert into public.venue_tables(id,venue_id,name,min_guests,max_guests,requires_approval) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','T1',2,8,false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
do $$ begin
  begin
    insert into public.venue_tables(venue_id,name) values ('00000000-0000-0000-0000-000000000001','Unauthorized');
    raise exception 'TEST FAILED: guest managed tables';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_table_reservation('10000000-0000-0000-0000-000000000001',now()-interval '1 hour',4);
    raise exception 'TEST FAILED: past booking accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_table_reservation('10000000-0000-0000-0000-000000000001',now()+interval '1 day',9);
    raise exception 'TEST FAILED: oversized party accepted';
  exception when invalid_parameter_value then null; end;
end $$;
select public.create_table_reservation('10000000-0000-0000-0000-000000000001',now()+interval '1 day',4);
do $$ begin
  if not exists(select 1 from public.table_reservations where status='confirmed') then raise exception 'TEST FAILED: instant confirmation'; end if;
  begin
    perform public.create_table_reservation('10000000-0000-0000-0000-000000000001',now()+interval '1 day 1 hour',4);
    raise exception 'TEST FAILED: overlapping booking accepted';
  exception when exclusion_violation then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
do $$ begin
  if exists(select 1 from public.table_reservations) then raise exception 'TEST FAILED: another guest can read bookings'; end if;
  if not exists(select 1 from public.get_table_availability('00000000-0000-0000-0000-000000000001',now(),now()+interval '3 days')) then raise exception 'TEST FAILED: availability not visible'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select public.update_table_reservation_status(id,'cancelled') from public.table_reservations;
select public.create_table_reservation('10000000-0000-0000-0000-000000000001',now()+interval '1 day',4);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
update public.venue_tables set requires_approval=true;
select public.create_table_reservation('10000000-0000-0000-0000-000000000001',now()+interval '2 days',4);
do $$ begin
 if not exists(select 1 from public.table_reservations where status='pending') then raise exception 'TEST FAILED: approval request'; end if;
end $$;
select public.update_table_reservation_status(id,'confirmed') from public.table_reservations where status='pending';
rollback;
