create table if not exists public.influencer_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null unique,
  influencer_id text,
  influencer_name text not null,
  referral_code text not null unique check (referral_code ~ '^[a-z0-9][a-z0-9_-]{2,39}$'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.influencer_campaigns(campaign_id, influencer_id, influencer_name, referral_code)
values ('60seconds_OTown', 'OTown', 'OTown', 'otown-40rq')
on conflict (campaign_id) do nothing;

create table if not exists public.influencer_attributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  campaign_id text not null references public.influencer_campaigns(campaign_id),
  referral_code text not null,
  attribution_source text not null check (attribution_source in ('android_install_referrer','ios_deferred_deeplink','direct_deeplink','manual_code','organic')),
  platform text not null default 'unknown',
  first_open_at timestamptz,
  registered_at timestamptz not null default now(),
  external_status text not null default 'pending' check (external_status in ('pending','reported','failed','unknown')),
  external_reported_at timestamptz,
  last_error_category text,
  retry_count integer not null default 0 check (retry_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.influencer_reporting_outbox (
  id uuid primary key default gen_random_uuid(),
  attribution_id uuid not null unique references public.influencer_attributions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','reported','failed','unknown')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error_category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.influencer_campaigns enable row level security;
alter table public.influencer_attributions enable row level security;
alter table public.influencer_reporting_outbox enable row level security;

create policy "active campaigns can be read by clients" on public.influencer_campaigns
  for select to anon, authenticated using (active);
create policy "users can read own attribution" on public.influencer_attributions
  for select to authenticated using (auth.uid() = user_id);
-- Attribution writes and all outbox state transitions are service-role only.

create or replace function public.record_campaign_registration(
  p_user_id uuid,
  p_referral_code text,
  p_source text default 'manual_code',
  p_platform text default 'unknown',
  p_first_open_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare
  campaign public.influencer_campaigns%rowtype;
  attribution_id uuid;
begin
  if p_user_id is null or p_referral_code is null or p_referral_code !~ '^[a-z0-9][a-z0-9_-]{2,39}$' then
    raise exception 'invalid attribution';
  end if;
  select * into campaign from public.influencer_campaigns
    where referral_code = lower(p_referral_code) and active;
  if not found then raise exception 'unknown referral code'; end if;

  insert into public.influencer_attributions(user_id, campaign_id, referral_code, attribution_source, platform, first_open_at)
  values (p_user_id, campaign.campaign_id, campaign.referral_code, p_source, coalesce(p_platform, 'unknown'), p_first_open_at)
  on conflict (user_id) do nothing
  returning id into attribution_id;

  if attribution_id is not null then
    insert into public.influencer_reporting_outbox(attribution_id) values (attribution_id)
    on conflict (attribution_id) do nothing;
    return attribution_id;
  end if;
  select id into attribution_id from public.influencer_attributions where user_id = p_user_id;
  return attribution_id;
end;
$$;


revoke all on function public.record_campaign_registration(uuid,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.record_campaign_registration(uuid,text,text,text,timestamptz) to service_role;
grant select on public.influencer_campaigns to anon, authenticated;
grant select on public.influencer_attributions to authenticated;

create or replace function public.attach_campaign_attribution(
  p_user_id uuid,
  p_referral_code text,
  p_source text,
  p_platform text,
  p_first_open_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare
  campaign public.influencer_campaigns%rowtype;
  attribution_id uuid;
  existing_user_id uuid;
begin
  if p_user_id is null or p_referral_code is null or p_referral_code !~ '^[a-z0-9][a-z0-9_-]{2,39}$' then
    raise exception 'invalid attribution';
  end if;
  select id into existing_user_id from auth.users where id = p_user_id;
  if existing_user_id is null then raise exception 'user not found'; end if;
  select * into campaign from public.influencer_campaigns
    where referral_code = lower(p_referral_code) and active;
  if not found then raise exception 'unknown referral code'; end if;

  insert into public.influencer_attributions(user_id,campaign_id,referral_code,attribution_source,platform,first_open_at)
  values(p_user_id,campaign.campaign_id,campaign.referral_code,
    case when p_source in ('android_install_referrer','ios_deferred_deeplink','direct_deeplink','manual_code','organic') then p_source else 'manual_code' end,
    coalesce(p_platform,'unknown'),p_first_open_at)
  on conflict(user_id) do nothing returning id into attribution_id;

  if attribution_id is null then
    select id into attribution_id from public.influencer_attributions
      where user_id = p_user_id and campaign_id = campaign.campaign_id and referral_code = campaign.referral_code;
    if attribution_id is null then raise exception 'user already has a different campaign attribution'; end if;
  else
    insert into public.influencer_reporting_outbox(attribution_id) values(attribution_id)
    on conflict(attribution_id) do nothing;
  end if;
  return attribution_id;
end;
$$;

revoke all on function public.attach_campaign_attribution(uuid,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.attach_campaign_attribution(uuid,text,text,text,timestamptz) to service_role;

create or replace function public.claim_influencer_reporting_batch(p_limit integer default 25)
returns table(outbox_id uuid, attribution_id uuid, referral_code text, campaign_id text, attempts integer)
language sql security definer set search_path = public
as $$
  with picked as (
    select o.id
    from public.influencer_reporting_outbox o
    where o.status = 'pending' and o.next_attempt_at <= now()
    order by o.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit,25),100))
  ), claimed as (
    update public.influencer_reporting_outbox o
    set status='processing', attempts=o.attempts+1, updated_at=now()
    from picked p where o.id=p.id
    returning o.id, o.attribution_id, o.attempts
  )
  select c.id, a.id, a.referral_code, a.campaign_id, c.attempts
  from claimed c join public.influencer_attributions a on a.id=c.attribution_id;
$$;

revoke all on function public.claim_influencer_reporting_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_influencer_reporting_batch(integer) to service_role;
