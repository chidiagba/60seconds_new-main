-- Fix RLS Policies for Events Table
-- This script fixes the "new row violates row-level security policy" error

-- First, drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Allow read access to public events" ON events CASCADE;
DROP POLICY IF EXISTS "Allow authenticated users to insert events" ON events CASCADE;
DROP POLICY IF EXISTS "Allow users to update their own events" ON events CASCADE;
DROP POLICY IF EXISTS "Allow users to delete their own events" ON events CASCADE;

-- Recreate the policies with proper permissions
-- Allow users to read all public events and their own events
CREATE POLICY "Allow read access to public events" ON events
  FOR SELECT USING (is_public = true OR auth.uid() = user_id);

-- Allow authenticated users to insert events (this was the main issue)
CREATE POLICY "Allow authenticated users to insert events" ON events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Allow users to update their own events
CREATE POLICY "Allow users to update their own events" ON events
  FOR UPDATE USING (auth.uid() = user_id);

-- Allow users to delete their own events
CREATE POLICY "Allow users to delete their own events" ON events
  FOR DELETE USING (auth.uid() = user_id);

-- Also ensure the events table has RLS enabled
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Grant necessary permissions
GRANT ALL ON TABLE events TO authenticated;
GRANT ALL ON TABLE events TO anon;

SELECT 'RLS policies for events table have been fixed!' as message;
