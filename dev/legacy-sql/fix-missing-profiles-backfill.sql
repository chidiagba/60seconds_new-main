-- Backfill missing profiles rows so uploads do not fail with videos_user_id_fkey.
-- Safe to run multiple times.

WITH candidates AS (
  SELECT
    u.id,
    lower(coalesce(u.email, u.id::text || '@example.com')) AS base_email,
    left(replace(u.id::text, '-', ''), 8) AS short_id,
    u.raw_user_meta_data
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE p.id IS NULL
)
INSERT INTO public.profiles (
  id,
  email,
  full_name,
  username,
  user_type,
  followers_count,
  following_count,
  created_at,
  updated_at
)
SELECT
  c.id,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.profiles p2 WHERE p2.email = c.base_email)
      THEN split_part(c.base_email, '@', 1) || '+' || c.short_id || '@' || coalesce(nullif(split_part(c.base_email, '@', 2), ''), 'example.com')
    ELSE c.base_email
  END AS email,
  coalesce(
    nullif(trim(c.raw_user_meta_data->>'full_name'), ''),
    split_part(c.base_email, '@', 1),
    'User'
  ) AS full_name,
  left(
    regexp_replace(
      lower(
        coalesce(
          nullif(trim(c.raw_user_meta_data->>'username'), ''),
          nullif(trim(c.raw_user_meta_data->>'full_name'), ''),
          split_part(c.base_email, '@', 1),
          'user'
        )
      ),
      '[^a-z0-9_]+',
      '_',
      'g'
    ) || '_' || c.short_id,
    30
  ) AS username,
  CASE
    WHEN lower(coalesce(c.raw_user_meta_data->>'user_type', 'private')) = 'business' THEN 'business'
    ELSE 'private'
  END AS user_type,
  0 AS followers_count,
  0 AS following_count,
  now() AS created_at,
  now() AS updated_at
FROM candidates c;

-- Ensure future users get a profile row automatically.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.id) THEN
    INSERT INTO public.profiles (
      id,
      email,
      full_name,
      username,
      user_type,
      followers_count,
      following_count
    )
    VALUES (
      NEW.id,
      CASE
        WHEN EXISTS (SELECT 1 FROM public.profiles p2 WHERE p2.email = lower(coalesce(NEW.email, NEW.id::text || '@example.com')))
          THEN split_part(lower(coalesce(NEW.email, NEW.id::text || '@example.com')), '@', 1)
            || '+' || left(replace(NEW.id::text, '-', ''), 8)
            || '@' || coalesce(nullif(split_part(lower(coalesce(NEW.email, NEW.id::text || '@example.com')), '@', 2), ''), 'example.com')
        ELSE lower(coalesce(NEW.email, NEW.id::text || '@example.com'))
      END,
      coalesce(
        nullif(trim(NEW.raw_user_meta_data->>'full_name'), ''),
        split_part(lower(coalesce(NEW.email, NEW.id::text || '@example.com')), '@', 1),
        'User'
      ),
      left(
        regexp_replace(
          lower(
            coalesce(
              nullif(trim(NEW.raw_user_meta_data->>'username'), ''),
              nullif(trim(NEW.raw_user_meta_data->>'full_name'), ''),
              split_part(lower(coalesce(NEW.email, NEW.id::text || '@example.com')), '@', 1),
              'user'
            )
          ),
          '[^a-z0-9_]+',
          '_',
          'g'
        ) || '_' || left(replace(NEW.id::text, '-', ''), 8),
        30
      ),
      CASE
        WHEN lower(coalesce(NEW.raw_user_meta_data->>'user_type', 'private')) = 'business' THEN 'business'
        ELSE 'private'
      END,
      0,
      0
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
