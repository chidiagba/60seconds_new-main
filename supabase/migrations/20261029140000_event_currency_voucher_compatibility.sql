-- Keep existing shared links in the currency selected for their offers.
update public.events e set currency = p.currency
from (
  select event_id, min(upper(trim(currency))) as currency
  from public.products where is_active and price > 0 and currency ~* '^[a-z]{3}$'
  group by event_id having count(distinct upper(trim(currency))) = 1
) p where e.id = p.event_id and e.currency is distinct from p.currency;

-- Production's original voucher schema used two discount columns and required
-- creator_id. Accept both that schema's clients and current mobile clients.
alter table public.vouchers add column if not exists creator_id uuid references public.profiles(id);
alter table public.vouchers add column if not exists title text;
alter table public.vouchers add column if not exists discount_type text;
alter table public.vouchers add column if not exists discount_value numeric;
alter table public.vouchers add column if not exists discount_percentage numeric;
alter table public.vouchers add column if not exists product_id uuid references public.products(id);
update public.vouchers set
  creator_id = coalesce(creator_id,business_id),
  title = coalesce(title,name,code),
  discount_type = coalesce(discount_type,case when discount_percentage > 0 then 'percentage' else 'fixed' end),
  discount_value = coalesce(discount_value,case when discount_percentage > 0 then discount_percentage else discount_amount end);

create or replace function public.normalize_voucher_fields() returns trigger
language plpgsql set search_path=public as $$
begin
  new.creator_id := coalesce(new.creator_id,new.business_id);
  new.code := upper(trim(new.code));
  new.name := coalesce(nullif(trim(new.name),''),new.title,new.code);
  new.title := new.name;
  -- Legacy clients change the two separate columns; modern clients change value/type.
  if tg_op='UPDATE' and new.discount_type is not distinct from old.discount_type
     and new.discount_value is not distinct from old.discount_value
     and (new.discount_percentage is distinct from old.discount_percentage or new.discount_amount is distinct from old.discount_amount) then
    new.discount_type := case when new.discount_percentage > 0 then 'percentage' else 'fixed' end;
    new.discount_value := case when new.discount_percentage > 0 then new.discount_percentage else new.discount_amount end;
  end if;
  new.discount_type := coalesce(new.discount_type,case when new.discount_percentage > 0 then 'percentage' else 'fixed' end);
  if new.discount_type='fixed_amount' then new.discount_type:='fixed'; end if;
  new.discount_value := coalesce(new.discount_value,case when new.discount_type='percentage' then new.discount_percentage else new.discount_amount end);
  if new.discount_type not in ('percentage','fixed') or new.discount_value is null or new.discount_value<=0
     or (new.discount_type='percentage' and new.discount_value>100) then raise exception 'Enter a valid voucher discount'; end if;
  if new.usage_limit<0 or new.min_purchase_amount<0 or new.max_discount_amount<0 then raise exception 'Voucher limits cannot be negative'; end if;
  new.discount_percentage := case when new.discount_type='percentage' then new.discount_value else null end;
  new.discount_amount := case when new.discount_type='fixed' then new.discount_value else null end;
  return new;
end $$;
drop trigger if exists normalize_voucher_fields on public.vouchers;
create trigger normalize_voucher_fields before insert or update on public.vouchers
for each row execute function public.normalize_voucher_fields();
notify pgrst,'reload schema';
