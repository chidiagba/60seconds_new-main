-- Trusted verification facts are written only inside service-only settlement RPCs.
-- Existing permissive production policies must not permit client receipt writes.
revoke insert,update,delete on public.ticket_receipts from anon,authenticated;
create policy receipts_server_insert_only on public.ticket_receipts as restrictive for insert to authenticated with check(false);
create policy receipts_server_update_only on public.ticket_receipts as restrictive for update to authenticated using(false) with check(false);
create policy receipts_server_delete_only on public.ticket_receipts as restrictive for delete to authenticated using(false);

create or replace function public.guard_verified_order_transition() returns trigger
language plpgsql security definer set search_path=public as $$
declare changed boolean; trusted boolean;
begin
 changed:=tg_op='INSERT';
 if tg_op='UPDATE' then changed:=new.payment_status is distinct from old.payment_status or new.status is distinct from old.status; end if;
 if not changed then return new; end if;
 if new.status in ('open','confirmed','completed','partially_completed') and new.payment_status<>'paid' then
  raise exception 'Verified payment or authorized zero checkout required';
 end if;
 if new.payment_status='paid' and (tg_op='INSERT' or old.payment_status is distinct from 'paid') then
  trusted:=exists(select 1 from checkout_orders c where c.order_id=new.id and c.state in ('reserved','fulfilled')
    and (c.quote->>'total_amount')::numeric=new.total_amount and c.user_id=new.user_id
    and ((new.total_amount=0 and new.payment_provider='voucher' and (c.quote->>'voucher_id')::uuid is not distinct from new.voucher_id)
      or exists(select 1 from checkout_payment_evidence e where e.order_id=new.id and e.provider=new.payment_provider
        and e.reference=new.payment_reference and e.amount=new.total_amount and e.currency=new.currency)));
  if not trusted then
   trusted:=exists(select 1 from guest_checkouts g join checkout_payment_evidence e on e.order_id=g.order_id
     where g.order_id=new.id and g.state in ('reserved','paid') and e.amount=new.total_amount
       and e.currency=new.currency and e.reference=new.payment_reference and g.session_id=e.reference);
  end if;
  if not trusted then raise exception 'Verified payment evidence required; legacy order needs reconciliation'; end if;
 end if;
 return new;
end $$;
create trigger guard_verified_order_transition before insert or update on public.orders for each row execute function public.guard_verified_order_transition();

create or replace function public.guard_verified_receipt() returns trigger
language plpgsql security definer set search_path=public as $$
declare o orders; expected integer; already integer;
begin
 select * into o from orders where id=new.order_id for update;
 if not found then raise exception 'Order not found'; end if;
 if tg_op='UPDATE' and new.is_active=false and new.redeemed_at is not distinct from old.redeemed_at and o.payment_status='refunded' then return new; end if;
 if o.payment_status<>'paid' then raise exception 'Receipt requires a paid order'; end if;
 if tg_op='UPDATE' then return new; end if;
 if new.buyer_id is distinct from o.user_id or new.owner_id is distinct from o.business_id then raise exception 'Receipt ownership mismatch'; end if;
 if not exists(select 1 from checkout_orders c where c.order_id=o.id and c.state='reserved')
   and not exists(select 1 from guest_checkouts g join checkout_payment_evidence e on e.order_id=g.order_id where g.order_id=o.id and g.state='reserved' and e.amount=o.total_amount and e.currency=o.currency) then
  raise exception 'Receipt issuance must run inside verified atomic fulfillment';
 end if;
 select coalesce(sum(case when i->>'type'='ticket' then (i->>'quantity')::integer else 1 end),0)
 into expected from jsonb_array_elements(o.items) i where i->>'product_id'=new.product_id::text;
 select count(*) into already from ticket_receipts where order_id=o.id and product_id=new.product_id;
 if expected=0 or already>=expected then raise exception 'Receipt quantity exceeds authorized purchase'; end if;
 return new;
end $$;
create trigger guard_verified_receipt before insert or update of redeemed_at,is_active on public.ticket_receipts for each row execute function public.guard_verified_receipt();

create or replace function public.get_verified_order_receipts(order_key uuid) returns setof public.ticket_receipts
language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not exists(select 1 from orders where id=order_key and payment_status='paid' and auth.uid() in(user_id,business_id)) then raise exception 'Verified purchase not found'; end if;
 return query select * from ticket_receipts where order_id=order_key;
end $$;
revoke all on function public.get_verified_order_receipts(uuid) from public,anon;
grant execute on function public.get_verified_order_receipts(uuid) to authenticated;

-- Guest session retrieval/signature verification occurs before this service RPC.
-- Evidence, financial ledger, paid state and receipts now commit in one call.
alter table public.payments alter column user_id drop not null;
create or replace function public.settle_verified_guest_payment(order_key uuid,provider text,reference text,paid_amount numeric,paid_currency text,transaction_key text)
returns public.orders language plpgsql security definer set search_path=public as $$
declare o orders; g guest_checkouts; w wallets; net numeric;
begin
 select * into o from orders where id=order_key for update;
 select * into g from guest_checkouts where order_id=order_key for update;
 if not found or g.state='released' or provider is distinct from g.provider or nullif(reference,'') is null
  or nullif(transaction_key,'') is null or paid_amount is distinct from o.total_amount or upper(paid_currency) is distinct from upper(o.currency) then raise exception 'Verified guest payment mismatch'; end if;
 if g.session_id is not null and g.session_id<>reference then raise exception 'Guest payment reference mismatch'; end if;
 if g.state='paid' then
  if not exists(select 1 from checkout_payment_evidence e where e.order_id=o.id and e.reference=settle_verified_guest_payment.reference) then raise exception 'Legacy guest purchase requires reconciliation'; end if;
  return o;
 end if;
 insert into checkout_payment_evidence(order_id,provider,reference,transaction_id,amount,currency) values(o.id,provider,reference,transaction_key,paid_amount,upper(paid_currency));
 update guest_checkouts set session_id=reference where order_id=o.id;
 update orders set payment_provider=provider,payment_method=provider,payment_reference=reference,payment_transaction_id=transaction_key where id=o.id;
 net:=round(o.total_amount/1.04,2);
 insert into wallets(user_id,currency,is_active) values(o.business_id,o.currency,true) on conflict(user_id) do update set is_active=true returning * into w;
 if upper(w.currency)<>upper(o.currency) then raise exception 'Organizer wallet currency mismatch'; end if;
 update wallets set balance=coalesce(balance,0)+net,updated_at=now() where id=w.id;
 insert into transactions(wallet_id,amount,type,status,description,transaction_fee,metadata)
 values(w.id,net,'deposit','completed','Guest purchase',0,jsonb_build_object('entry','owner_credit','order_id',o.id,'payment_reference',reference,'payment_provider',provider,'payment_transaction_id',transaction_key,'gross_amount',o.total_amount,'net_amount',net,'currency',o.currency));
 select * into o from finish_guest_order(o.id,true,reference);
 insert into payments(order_id,user_id,organizer_id,payment_provider,provider_reference,amount,currency,status,transaction_id,net_amount,processing_fee,paid_at,completed_at)
 values(o.id,o.user_id,o.business_id,provider,reference,o.total_amount,o.currency,'completed',transaction_key,net,o.total_amount-net,now(),now())
 on conflict(payment_provider,provider_reference) do update set status='completed',transaction_id=excluded.transaction_id,paid_at=now(),completed_at=now();
 return o;
end $$;
revoke all on function public.settle_verified_guest_payment(uuid,text,text,numeric,text,text) from public,anon,authenticated;
grant execute on function public.settle_verified_guest_payment(uuid,text,text,numeric,text,text) to service_role;

-- Missing voucher triggers in production are installed without replaying old migrations.
drop trigger if exists validate_order_voucher on public.orders;
create trigger validate_order_voucher before insert on public.orders for each row execute function public.validate_order_voucher();
drop trigger if exists consume_order_voucher on public.orders;
create trigger consume_order_voucher after insert or update of payment_status on public.orders for each row execute function public.consume_order_voucher();
