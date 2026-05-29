-- Add avatar_gender column to profiles table
-- Run this in the Supabase SQL Editor

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS avatar_gender TEXT
CHECK (avatar_gender IN ('male', 'female'));

-- Optional: index for fast lookups by gender avatar
-- CREATE INDEX IF NOT EXISTS idx_profiles_avatar_gender ON profiles(avatar_gender);
