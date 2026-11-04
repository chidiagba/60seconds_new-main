-- Normalize the legacy voucher schemas used by earlier app versions.
alter table public.vouchers add column if not exists name text;
alter table public.vouchers add column if not exists title text;
alter table public.vouchers add column if not exists discount_value numeric;
alter table public.vouchers add column if not exists discount_amount numeric;
alter table public.vouchers add column if not exists product_id uuid references public.products(id);
alter table public.vouchers add column if not exists min_purchase_amount numeric;
alter table public.vouchers add column if not exists max_discount_amount numeric;
update public.vouchers v set
 name=coalesce(nullif(v.name,''),v.title,v.code),
 discount_value=coalesce(v.discount_value,v.discount_amount,0),
 min_purchase_amount=coalesce(v.min_purchase_amount,(to_jsonb(v)->>'minimum_order_amount')::numeric),
 max_discount_amount=coalesce(v.max_discount_amount,(to_jsonb(v)->>'maximum_discount_amount')::numeric);
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.vouchers'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%discount_type%' loop
 execute format('alter table public.vouchers drop constraint %I',c.conname);
 end loop;
end $$;
update public.vouchers set discount_type='fixed' where discount_type='fixed_amount';
alter table public.vouchers add constraint vouchers_discount_type_check check(discount_type in ('percentage','fixed'));
create or replace function public.normalize_voucher_fields() returns trigger language plpgsql set search_path=public as $$
begin
 new.code := upper(trim(new.code));
 new.name := coalesce(nullif(new.name,''),new.title,new.code);
 new.title := new.name;
 new.discount_value := coalesce(new.discount_value,new.discount_amount);
 new.discount_amount := new.discount_value;
 if new.discount_value is null or new.discount_value <= 0 or (new.discount_type='percentage' and new.discount_value > 100) then raise exception 'Invalid voucher discount'; end if;
 if new.usage_limit < 0 or new.min_purchase_amount < 0 or new.max_discount_amount < 0 then raise exception 'Voucher limits cannot be negative'; end if;
 return new;
end $$;
create trigger normalize_voucher_fields before insert or update on public.vouchers for each row execute function public.normalize_voucher_fields();
