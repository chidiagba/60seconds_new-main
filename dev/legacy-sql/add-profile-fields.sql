-- Add missing fields to profiles table
-- Run this in your Supabase SQL Editor

-- Add location_city column
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS location_city TEXT;

-- Add hashtags column as text array
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS hashtags TEXT[];

-- Add comments for documentation
COMMENT ON COLUMN profiles.location_city IS 'User location/city';
COMMENT ON COLUMN profiles.hashtags IS 'User hashtags as text array';

-- Update RLS policies to include new fields
-- Allow users to update their own profile with new fields
DROP POLICY IF EXISTS "Allow users to update their own profile" ON profiles;
CREATE POLICY "Allow users to update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Allow users to insert their own profile with new fields  
DROP POLICY IF EXISTS "Allow users to insert their own profile" ON profiles;
CREATE POLICY "Allow users to insert their own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Show the updated table structure
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'profiles' 
ORDER BY ordinal_position;
