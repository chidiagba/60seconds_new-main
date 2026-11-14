-- Forward-only repair for the deployed PostgREST checkout_orders schema-cache error.
-- The table is created empty if an earlier partial deployment omitted it.
create table if not exists public.checkout_orders (
  order_id uuid primary key references public.orders(id) deferrable initially deferred,
  user_id uuid not null references public.profiles(id),
  request_key text not null,
  requested_items jsonb not null,
  quote jsonb not null,
  state text not null default 'reserved' check (state in ('reserved','fulfilled','released')),
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  unique(user_id, request_key)
);

alter table public.checkout_orders enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='checkout_orders' and policyname='checkout_orders_read'
  ) then
    create policy checkout_orders_read on public.checkout_orders
      for select to authenticated using (user_id=auth.uid());
  end if;
end $$;
grant select on public.checkout_orders to authenticated;

create or replace function public.get_checkout_attempt(p_request_key text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare attempt public.checkout_orders%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='Authentication required';
  end if;
  select * into attempt from public.checkout_orders c
  where c.user_id=auth.uid() and c.request_key=p_request_key;
  if not found then return null; end if;
  return jsonb_build_object('order_id',attempt.order_id,'quote',attempt.quote,'state',attempt.state);
end;
$$;
revoke all on function public.get_checkout_attempt(text) from public,anon;
grant execute on function public.get_checkout_attempt(text) to authenticated;

notify pgrst, 'reload schema';
