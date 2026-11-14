-- OTP state is never readable or writable through the public API.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS private.otp_limits (
  key text PRIMARY KEY, window_start timestamptz NOT NULL, last_request timestamptz NOT NULL, attempts integer NOT NULL
);
CREATE TABLE IF NOT EXISTS private.signup_otp (
  email text PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL, expires_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0
);
ALTER TABLE private.otp_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.signup_otp ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.allow_otp_request(target_email text, target_ip text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, private AS $$
DECLARE k text; row private.otp_limits; allowed boolean := true;
BEGIN
  -- Stable lock order prevents deadlocks; shared rows serialize simultaneous requests.
  FOR k IN SELECT unnest(ARRAY['email:' || lower(target_email), 'ip:' || target_ip]) ORDER BY 1 LOOP
    INSERT INTO private.otp_limits VALUES (k, now(), now() - interval '1 hour', 0) ON CONFLICT DO NOTHING;
    SELECT * INTO row FROM private.otp_limits WHERE key = k FOR UPDATE;
    IF row.window_start <= now() - interval '1 hour' THEN
      UPDATE private.otp_limits SET window_start = now(), attempts = 0 WHERE key = k;
      row.attempts := 0;
    END IF;
    IF row.attempts >= (CASE WHEN k LIKE 'email:%' THEN 5 ELSE 30 END)
       OR (k LIKE 'email:%' AND row.last_request > now() - interval '60 seconds') THEN
      allowed := false;
    ELSE
      UPDATE private.otp_limits SET attempts = attempts + 1, last_request = now() WHERE key = k;
    END IF;
  END LOOP;
  RETURN allowed;
END $$;

CREATE OR REPLACE FUNCTION public.issue_signup_otp(target_email text, target_user uuid, target_code text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, private, extensions AS $$
  INSERT INTO private.signup_otp(email, user_id, code_hash, expires_at, attempts)
  VALUES(lower(target_email), target_user, encode(extensions.digest(target_code, 'sha256'), 'hex'), now() + interval '10 minutes', 0)
  ON CONFLICT(email) DO UPDATE SET user_id = excluded.user_id, code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0;
$$;

CREATE OR REPLACE FUNCTION public.consume_signup_otp(target_email text, target_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, private, extensions AS $$
DECLARE row private.signup_otp;
BEGIN
  SELECT * INTO row FROM private.signup_otp WHERE email = lower(target_email) FOR UPDATE;
  IF NOT FOUND OR row.expires_at <= now() OR row.attempts >= 5 THEN RETURN NULL; END IF;
  UPDATE private.signup_otp SET attempts = attempts + 1 WHERE email = lower(target_email);
  IF row.code_hash <> encode(extensions.digest(target_code, 'sha256'), 'hex') THEN RETURN NULL; END IF;
  DELETE FROM private.signup_otp WHERE email = lower(target_email);
  RETURN row.user_id;
END $$;
REVOKE ALL ON FUNCTION public.allow_otp_request(text,text), public.issue_signup_otp(text,uuid,text), public.consume_signup_otp(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allow_otp_request(text,text), public.issue_signup_otp(text,uuid,text), public.consume_signup_otp(text,text) TO service_role;
-- Retire previously stored plaintext codes and tokens embedded in metadata.
DELETE FROM public.otp_codes;
REVOKE ALL ON public.otp_codes FROM anon, authenticated;
UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data - ARRAY['latest_otp_code','latest_otp_type','latest_otp_email','latest_otp_expires_at','signup_last_otp_code','signup_last_otp_expires_at'];
