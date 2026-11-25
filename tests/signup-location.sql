\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('bc120000-0000-4000-8000-000000000001','signup-location@example.test','{"country":" Nigeria ","country_code":" ng ","location_city":" Lagos ","currency":"NGN"}'),
 ('bc120000-0000-4000-8000-000000000002','explicit-location@example.test','{"country":"Nigeria","country_code":"NG","location_city":"Lagos","currency":"NGN"}');
-- Reproduce hosted handle_new_user: its profile INSERT omits all location fields.
insert into profiles(id,email,user_type) values('bc120000-0000-4000-8000-000000000001','signup-location@example.test','private');
insert into profiles(id,email,user_type,country,country_code,location_city,currency) values('bc120000-0000-4000-8000-000000000002','explicit-location@example.test','business','Switzerland','ch','Zürich','CHF');
do $$ begin
 if not exists(select 1 from profiles where id='bc120000-0000-4000-8000-000000000001' and country='Nigeria' and country_code='NG' and location_city='Lagos') then raise exception 'Signup location was lost';end if;
 if not exists(select 1 from wallets where user_id='bc120000-0000-4000-8000-000000000001' and currency='NGN') then raise exception 'Wallet provisioned before country hydration';end if;
 if not exists(select 1 from profiles where id='bc120000-0000-4000-8000-000000000002' and country='Switzerland' and country_code='CH' and location_city='Zürich' and currency='CHF') then raise exception 'Explicit profile location overwritten';end if;
 if has_function_privilege('authenticated','public.hydrate_signup_profile_location()','EXECUTE') then raise exception 'Private trigger exposed';end if;
end $$;
rollback;
