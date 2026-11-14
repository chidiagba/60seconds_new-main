-- Add business country fields used for automatic currency defaults
-- Run this once in Supabase SQL Editor

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS country TEXT,
ADD COLUMN IF NOT EXISTS country_code TEXT;

COMMENT ON COLUMN profiles.country IS 'Selected country name during signup (especially for business accounts)';
COMMENT ON COLUMN profiles.country_code IS 'ISO 3166-1 alpha-2 code selected during signup';
