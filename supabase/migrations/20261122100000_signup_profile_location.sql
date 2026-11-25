-- New profiles inherit the location explicitly entered at signup. No historic backfill.
-- BEFORE INSERT runs before the existing wallet provisioner, so country/currency are available.
create or replace function public.hydrate_signup_profile_location()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare metadata jsonb;
begin
 select raw_user_meta_data into metadata from auth.users where id=new.id;
 new.country:=coalesce(nullif(trim(new.country),''),nullif(trim(metadata->>'country'),''));
 new.country_code:=upper(coalesce(nullif(trim(new.country_code),''),nullif(trim(metadata->>'country_code'),'')));
 new.location_city:=coalesce(nullif(trim(new.location_city),''),nullif(left(trim(metadata->>'location_city'),120),''));
 new.currency:=coalesce(nullif(trim(new.currency),''),nullif(upper(trim(metadata->>'currency')),''));
 return new;
end $$;
revoke all on function public.hydrate_signup_profile_location() from public,anon,authenticated;
drop trigger if exists hydrate_signup_profile_location on public.profiles;
create trigger hydrate_signup_profile_location before insert on public.profiles
 for each row execute function public.hydrate_signup_profile_location();
