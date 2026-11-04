-- Older installed apps can still publish an event with the USD default before
-- inserting offers in the selected currency. Keep the stored checkout currency
-- aligned as those offers are inserted, edited, moved or removed.
create or replace function public.sync_event_offer_currency() returns trigger
language plpgsql security definer set search_path=public as $$
declare event_key uuid; event_keys uuid[]; currencies text[];
begin
  if tg_op='DELETE' then event_keys:=array[old.event_id];
  elsif tg_op='INSERT' then event_keys:=array[new.event_id];
  else event_keys:=array[old.event_id,new.event_id]; end if;
  for event_key in select distinct unnest(event_keys) loop
    if event_key is null then continue; end if;
    perform 1 from public.events where id=event_key for update;
    select array_agg(distinct upper(trim(currency))) into currencies
    from public.products where event_id=event_key and is_active and price>0 and nullif(trim(currency),'') is not null;
    if cardinality(currencies)=1 and currencies[1] ~ '^[A-Z]{3}$' then
      update public.events set currency=currencies[1] where id=event_key and currency is distinct from currencies[1];
    end if;
  end loop;
  return null;
end $$;
revoke all on function public.sync_event_offer_currency() from public;
create trigger sync_event_offer_currency after insert or update of currency,event_id,is_active,price or delete
on public.products for each row execute function public.sync_event_offer_currency();
