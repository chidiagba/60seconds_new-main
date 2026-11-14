create or replace function public.capture_auth_campaign_attribution()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  attribution jsonb;
  referral_code_value text;
  campaign public.influencer_campaigns%rowtype;
  source_value text;
  platform_value text;
  first_open_value timestamptz;
  attribution_id uuid;
begin
  attribution := new.raw_user_meta_data->'campaign_attribution';
  if attribution is null or jsonb_typeof(attribution) <> 'object' then
    return new;
  end if;

  referral_code_value := lower(trim(coalesce(attribution->>'referral_code','')));
  if referral_code_value !~ '^[a-z0-9][a-z0-9_-]{2,39}$' then
    raise exception 'invalid campaign referral';
  end if;
  select * into campaign from public.influencer_campaigns
    where referral_code=referral_code_value and active;
  if not found then raise exception 'unknown campaign referral'; end if;

  source_value := coalesce(attribution->>'source','manual_code');
  if source_value not in ('android_install_referrer','ios_deferred_deeplink','direct_deeplink','manual_code','organic') then
    source_value := 'manual_code';
  end if;
  platform_value := coalesce(attribution->>'platform','unknown');
  if platform_value not in ('android','ios','web') then platform_value := 'unknown'; end if;
  begin
    first_open_value := nullif(attribution->>'first_open_at','')::timestamptz;
  exception when others then
    first_open_value := null;
  end;

  insert into public.influencer_attributions(
    user_id,campaign_id,referral_code,attribution_source,platform,first_open_at
  ) values (
    new.id,campaign.campaign_id,campaign.referral_code,source_value,platform_value,first_open_value
  ) on conflict(user_id) do nothing returning id into attribution_id;

  if attribution_id is not null then
    insert into public.influencer_reporting_outbox(attribution_id)
    values(attribution_id) on conflict(attribution_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.capture_auth_campaign_attribution() from public, anon, authenticated;

drop trigger if exists on_auth_user_campaign_attribution on auth.users;
create trigger on_auth_user_campaign_attribution
  after insert on auth.users
  for each row execute function public.capture_auth_campaign_attribution();
