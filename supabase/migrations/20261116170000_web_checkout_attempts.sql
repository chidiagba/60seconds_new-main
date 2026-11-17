-- Additive web-only attempt tracking. Existing reservation/settlement functions remain unchanged.
create table public.web_checkout_attempts (
 request_key uuid primary key,
 order_id uuid not null unique references public.orders(id),
 event_id uuid not null references public.events(id),
 buyer_region text not null check (buyer_region in ('NG','OTHER')),
 payment_method text not null check (payment_method in ('paystack_card','paystack_transfer','stripe_card')),
 buyer_email text not null,
 requested_items jsonb not null,
 requested_tables jsonb not null,
 checkout_url text,
 created_at timestamptz not null default now()
);
alter table public.web_checkout_attempts enable row level security;
revoke all on public.web_checkout_attempts from public,anon,authenticated;
grant select,insert,update on public.web_checkout_attempts to service_role;

create function public.reserve_web_event_checkout(event_key uuid,buyer_email text,requested_items jsonb,requested_tables jsonb,request_key uuid,buyer_region text,payment_method text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare attempt web_checkout_attempts; purchase orders; checkout guest_checkouts; fresh boolean:=false;
begin
 if request_key is null or buyer_region not in ('NG','OTHER') or payment_method not in ('paystack_card','paystack_transfer','stripe_card') then raise exception 'Invalid payment selection'; end if;
 perform pg_advisory_xact_lock(hashtextextended('web-checkout:'||request_key::text,0));
 select * into attempt from web_checkout_attempts a where a.request_key=reserve_web_event_checkout.request_key;
 if found then
  if attempt.event_id is distinct from event_key or attempt.buyer_email is distinct from lower(trim(buyer_email))
   or attempt.buyer_region is distinct from buyer_region or attempt.payment_method is distinct from payment_method
   or attempt.requested_items is distinct from requested_items or attempt.requested_tables is distinct from requested_tables then
   raise exception 'An existing checkout has different details. Check its payment status before starting again';
  end if;
  select * into purchase from orders where id=attempt.order_id;
 else
  select * into purchase from reserve_event_order(event_key,lower(trim(buyer_email)),requested_items,requested_tables);
  insert into web_checkout_attempts(request_key,order_id,event_id,buyer_region,payment_method,buyer_email,requested_items,requested_tables)
  values(request_key,purchase.id,event_key,buyer_region,payment_method,lower(trim(buyer_email)),requested_items,requested_tables) returning * into attempt;
  update guest_checkouts set provider=case when payment_method='stripe_card' then 'stripe' else 'paystack' end where order_id=purchase.id;
  fresh:=true;
 end if;
 select * into checkout from guest_checkouts where order_id=purchase.id;
 return jsonb_build_object('order',to_jsonb(purchase),'fresh',fresh,'state',checkout.state,'expiresAt',checkout.expires_at,
  'url',case when checkout.state='reserved' and checkout.expires_at>now() then attempt.checkout_url else null end);
end $$;
revoke all on function public.reserve_web_event_checkout(uuid,text,jsonb,jsonb,uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_web_event_checkout(uuid,text,jsonb,jsonb,uuid,text,text) to service_role;
