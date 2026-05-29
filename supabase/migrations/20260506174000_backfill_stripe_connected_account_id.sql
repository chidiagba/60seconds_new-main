-- Ensure profiles has a stable Stripe Connect account id source.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_connected_account_id TEXT;

UPDATE public.profiles AS p
SET stripe_connected_account_id = src.connected_account_id
FROM (
  SELECT
    u.id,
    COALESCE(
      NULLIF(u.raw_app_meta_data ->> 'stripe_connected_account_id', ''),
      NULLIF(u.raw_app_meta_data ->> 'stripe_account_id', ''),
      NULLIF(u.raw_user_meta_data ->> 'stripe_connected_account_id', ''),
      NULLIF(u.raw_user_meta_data ->> 'stripe_account_id', '')
    ) AS connected_account_id
  FROM auth.users u
) AS src
WHERE p.id = src.id
  AND src.connected_account_id IS NOT NULL
  AND (p.stripe_connected_account_id IS NULL OR p.stripe_connected_account_id = '');

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_connected_account_id
  ON public.profiles(stripe_connected_account_id);