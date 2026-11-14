-- Wallet writes are server-only; provision empty wallets without exposing balance mutation.
CREATE OR REPLACE FUNCTION public.provision_profile_wallet()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 INSERT INTO public.wallets(user_id,balance,currency,is_verified,is_active)
 VALUES(NEW.id,0,CASE WHEN upper(coalesce(NEW.country_code,''))='NG' THEN 'NGN'
 ELSE coalesce(nullif(upper(NEW.currency),''),'USD') END,false,true)
 ON CONFLICT(user_id) DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.provision_profile_wallet() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS provision_profile_wallet ON public.profiles;
CREATE TRIGGER provision_profile_wallet AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.provision_profile_wallet();
INSERT INTO public.wallets(user_id,balance,currency,is_verified,is_active)
SELECT p.id,0,CASE WHEN upper(coalesce(p.country_code,''))='NG' THEN 'NGN'
 ELSE coalesce(nullif(upper(p.currency),''),'USD') END,false,true
FROM public.profiles p WHERE NOT EXISTS(SELECT 1 FROM public.wallets w WHERE w.user_id=p.id)
ON CONFLICT(user_id) DO NOTHING;
