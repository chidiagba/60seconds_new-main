BEGIN;
INSERT INTO auth.users(id,email) VALUES('63000000-0000-4000-8000-000000000001','review-lookup@example.test');
INSERT INTO public.profiles(id,email,country_code) VALUES('63000000-0000-4000-8000-000000000001','review-lookup@example.test','NG');
DO $$ BEGIN
 IF public.lookup_auth_user_by_email(' REVIEW-LOOKUP@EXAMPLE.TEST ')->>'id'<>'63000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'Case insensitive lookup failed'; END IF;
 IF public.lookup_auth_user_by_email('missing@example.test') IS NOT NULL THEN RAISE EXCEPTION 'Missing lookup returned identity'; END IF;
 IF has_function_privilege('anon','public.lookup_auth_user_by_email(text)','EXECUTE') OR has_function_privilege('authenticated','public.claim_welcome_email(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Public service function'; END IF;
 IF NOT public.allow_service_request('review-rate',2,600) OR NOT public.allow_service_request('review-rate',2,600) OR public.allow_service_request('review-rate',2,600) THEN RAISE EXCEPTION 'Rate limit failed'; END IF;
 UPDATE public.service_request_limits SET expires_at=now()-interval '1 second' WHERE bucket='review-rate';
 IF NOT public.allow_service_request('review-rate',2,600) THEN RAISE EXCEPTION 'Rate limit did not expire'; END IF;
 IF NOT public.claim_welcome_email('63000000-0000-4000-8000-000000000001') OR public.claim_welcome_email('63000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Concurrent welcome claim allowed'; END IF;
END $$;
ROLLBACK;
