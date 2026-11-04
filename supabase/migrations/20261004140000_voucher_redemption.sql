alter table public.orders add column if not exists voucher_id uuid references public.vouchers(id);
create unique index if not exists vouchers_code_normalized_unique on public.vouchers (upper(trim(code)));
create table public.voucher_redemptions (
 order_id uuid primary key references public.orders(id),
 voucher_id uuid not null references public.vouchers(id),
 redeemed_at timestamptz not null default now()
);
alter table public.voucher_redemptions enable row level security;
create or replace function public.redeem_paid_voucher(voucher_key uuid)
returns public.vouchers language plpgsql security definer set search_path = public as $$
declare v public.vouchers%rowtype; o public.orders%rowtype;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select * into v from public.vouchers where id=voucher_key for update;
 if not found then raise exception 'Voucher not found'; end if;
 -- Tie usage to a real paid purchase and make retries idempotent.
 select orders.* into o from public.orders
 where user_id=auth.uid() and payment_status='paid'
   and (voucher_id=v.id or upper(trim(substring(notes from 'Voucher applied: ([^[:space:]]+)'))) = upper(trim(v.code)))
 order by created_at desc limit 1 for update;
 if not found then raise exception 'A paid order using this voucher is required'; end if;
 if exists(select 1 from public.voucher_redemptions where order_id=o.id and voucher_id=v.id) then return v; end if;
 if not v.is_active then raise exception 'Voucher is inactive'; end if;
 if v.expiry_date is not null and v.expiry_date < o.created_at then raise exception 'Voucher has expired'; end if;
 if v.usage_limit is not null and v.usage_count >= v.usage_limit then raise exception 'Voucher usage limit reached'; end if;
 if exists(
   select 1 from jsonb_array_elements(o.items) i left join public.products p on p.id=(i->>'product_id')::uuid
   left join public.events e on e.id=p.event_id
   where p.id is null or coalesce(p.business_id,e.business_id,e.user_id) is distinct from v.business_id
      or (v.product_id is not null and p.id <> v.product_id)
 ) then raise exception 'Voucher is not valid for this purchase'; end if;
 insert into public.voucher_redemptions(order_id,voucher_id) values(o.id,v.id);
 update public.vouchers set usage_count=coalesce(usage_count,0)+1 where id=v.id returning * into v;
 return v;
end $$;
revoke all on function public.redeem_paid_voucher(uuid) from public;
grant execute on function public.redeem_paid_voucher(uuid) to authenticated;

create or replace function public.validate_order_voucher() returns trigger language plpgsql security definer set search_path=public as $$
declare v public.vouchers%rowtype; code_value text; item jsonb; p public.products%rowtype;
 owner_key uuid; marked_total numeric := 0; discount numeric; held integer;
begin
 code_value := upper(trim(substring(new.notes from 'Voucher applied: ([^[:space:]]+)')));
 new.voucher_id := coalesce(new.voucher_id,nullif(new.payment_metadata->>'voucher_id','')::uuid);
 if new.voucher_id is null and code_value is null then return new; end if;
 select * into v from public.vouchers where (new.voucher_id is not null and id=new.voucher_id) or (new.voucher_id is null and upper(trim(code))=code_value) for update;
 if not found then raise exception 'Voucher not found'; end if;
 if not v.is_active then raise exception 'Voucher is inactive'; end if;
 if v.expiry_date is not null and v.expiry_date <= now() then raise exception 'Voucher has expired'; end if;
 select count(*) into held from public.orders where voucher_id=v.id and payment_status='pending' and status <> 'cancelled' and created_at > now()-interval '1 hour';
 if v.usage_limit is not null and coalesce(v.usage_count,0)+held >= v.usage_limit then raise exception 'Voucher usage limit reached'; end if;
 for item in select value from jsonb_array_elements(new.items) loop
   select * into p from public.products where id=(item->>'product_id')::uuid;
   if not found or (item->>'quantity')::integer <= 0 then raise exception 'Invalid voucher products'; end if;
   select coalesce(p.business_id,business_id,user_id) into owner_key from public.events where id=p.event_id;
   owner_key := coalesce(p.business_id,owner_key);
   if owner_key is distinct from v.business_id or (v.product_id is not null and v.product_id <> p.id) then raise exception 'Voucher is not valid for these products'; end if;
   marked_total := marked_total + round(p.price*1.04,2)*(item->>'quantity')::integer;
 end loop;
 if marked_total < coalesce(v.min_purchase_amount,0) then raise exception 'Voucher minimum purchase amount not reached'; end if;
 discount := case when v.discount_type='percentage' then round(marked_total*v.discount_value/100,2) else v.discount_value end;
 if v.max_discount_amount is not null then discount := least(discount,v.max_discount_amount); end if;
 discount := least(marked_total,greatest(0,discount));
 if abs(new.total_amount-(marked_total-discount)) > 0.01 then raise exception 'Voucher total changed. Reapply the voucher before paying'; end if;
 new.voucher_id := v.id;
 return new;
end $$;
create trigger validate_order_voucher before insert on public.orders for each row execute function public.validate_order_voucher();

create or replace function public.consume_order_voucher() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.voucher_id is not null and new.payment_status='paid' then
   -- Database fulfillment handles usage even if the client closes after payment.
   perform 1 from public.vouchers where id=new.voucher_id for update;
   insert into public.voucher_redemptions(order_id,voucher_id) values(new.id,new.voucher_id) on conflict(order_id) do nothing;
   if found then update public.vouchers set usage_count=coalesce(usage_count,0)+1 where id=new.voucher_id; end if;
 end if;
 return new;
end $$;
create trigger consume_order_voucher after insert or update of payment_status on public.orders for each row execute function public.consume_order_voucher();
