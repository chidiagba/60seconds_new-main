-- Validate production constraints and RLS without retaining test records.
begin;
select set_config('request.jwt.claim.sub','fc8e08a5-cfb6-44e3-8834-07f6bb46415b',true);
set local role authenticated;
do $$ declare v public.vouchers; begin
  insert into public.vouchers(business_id,code,name,discount_type,discount_value,usage_limit)
  values(auth.uid(),'VERIFY-'||gen_random_uuid(),'Compatibility check','percentage',25,10) returning * into v;
  if v.creator_id<>auth.uid() or v.discount_percentage<>25 or v.discount_amount is not null then raise exception 'Modern voucher compatibility failed'; end if;
  update public.vouchers set discount_type='fixed',discount_value=500 where id=v.id returning * into v;
  if v.discount_amount<>500 or v.discount_percentage is not null then raise exception 'Fixed discount update failed'; end if;
  insert into public.vouchers(business_id,creator_id,code,name,discount_percentage)
  values(auth.uid(),auth.uid(),'VERIFY-'||gen_random_uuid(),'Legacy check',20) returning * into v;
  if v.discount_type<>'percentage' or v.discount_value<>20 then raise exception 'Legacy voucher compatibility failed'; end if;
end $$;
rollback;
