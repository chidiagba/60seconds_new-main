-- Supabase owns auth.users. Reuse its (instance_id, lower(email)) index.
CREATE OR REPLACE FUNCTION public.lookup_auth_user_by_email(p_email text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',id,'email',email) FROM auth.users WHERE instance_id='00000000-0000-0000-0000-000000000000'::uuid AND lower(email)=lower(trim(p_email)) LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.lookup_auth_user_by_email(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_auth_user_by_email(text) TO service_role;
CREATE TABLE public.service_request_limits(bucket text PRIMARY KEY,hits integer NOT NULL,expires_at timestamptz NOT NULL);
ALTER TABLE public.service_request_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_request_limits FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.service_request_limits TO service_role;
CREATE OR REPLACE FUNCTION public.allow_service_request(p_bucket text,p_limit integer,p_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE n integer;
BEGIN
 IF p_limit<1 OR p_seconds<1 THEN RETURN false; END IF;
 INSERT INTO public.service_request_limits(bucket,hits,expires_at) VALUES(p_bucket,1,now()+make_interval(secs=>p_seconds))
 ON CONFLICT(bucket) DO UPDATE SET hits=CASE WHEN service_request_limits.expires_at<=now() THEN 1 ELSE service_request_limits.hits+1 END,
 expires_at=CASE WHEN service_request_limits.expires_at<=now() THEN EXCLUDED.expires_at ELSE service_request_limits.expires_at END RETURNING hits INTO n;
 RETURN n<=p_limit;
END $$;
REVOKE ALL ON FUNCTION public.allow_service_request(text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.allow_service_request(text,integer,integer) TO service_role;
ALTER TABLE public.guest_checkouts ADD COLUMN IF NOT EXISTS email_sending_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS welcome_email_sending_at timestamptz;
-- Service-only claims prevent concurrent webhook/worker deliveries. Ambiguous sends remain claimed for investigation.
CREATE OR REPLACE FUNCTION public.claim_guest_email(p_order uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.guest_checkouts SET email_sending_at=now() WHERE order_id=p_order AND state='paid' AND email_sent_at IS NULL AND email_sending_at IS NULL;
 RETURN FOUND;
END $$;
CREATE OR REPLACE FUNCTION public.claim_welcome_email(p_user uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.profiles SET welcome_email_sending_at=now() WHERE id=p_user AND welcome_email_sent_at IS NULL AND welcome_email_sending_at IS NULL;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_guest_email(uuid),public.claim_welcome_email(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_email(uuid),public.claim_welcome_email(uuid) TO service_role;
NOTIFY pgrst,'reload schema';

ALTER TABLE public.guest_checkouts ADD COLUMN IF NOT EXISTS refund_claimed_at timestamptz;
CREATE OR REPLACE FUNCTION public.claim_guest_refund(p_order uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.guest_checkouts SET refund_pending=true,refund_claimed_at=now()
 WHERE order_id=p_order AND state='released' AND refund_id IS NULL
 AND (refund_claimed_at IS NULL OR refund_claimed_at<now()-interval '10 minutes');
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_guest_refund(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_refund(uuid) TO service_role;
