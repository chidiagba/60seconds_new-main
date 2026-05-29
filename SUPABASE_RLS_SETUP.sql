-- Supabase Row Level Security (RLS) Setup
-- Run this script in your Supabase SQL Editor to fix RLS policy violations

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

-- First, ensure storage schema exists and has proper permissions
GRANT USAGE ON SCHEMA storage TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO postgres, anon, authenticated, service_role;

-- Temporarily disable RLS on storage tables for setup
ALTER TABLE storage.buckets DISABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;

-- Grant necessary permissions for bucket operations
GRANT ALL ON storage.buckets TO postgres, anon, authenticated, service_role;
GRANT ALL ON storage.objects TO postgres, anon, authenticated, service_role;

-- Create storage buckets if they don't exist
-- This should be run as a superuser or service role
DO $$
BEGIN
  -- Create videos bucket
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'videos') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, owner)
    VALUES ('videos', 'videos', true, 104857600, ARRAY['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'], NULL);
    
    RAISE NOTICE 'Created videos bucket';
  ELSE
    RAISE NOTICE 'Videos bucket already exists';
  END IF;
  
  -- Create images bucket
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'images') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, owner)
    VALUES ('images', 'images', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'], NULL);
    
    RAISE NOTICE 'Created images bucket';
  ELSE
    RAISE NOTICE 'Images bucket already exists';
  END IF;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error creating buckets: %', SQLERRM;
    -- Continue with the script even if bucket creation fails
END $$;

-- PROFILES TABLE POLICIES
-- Allow users to read all profiles (for discovery)
CREATE POLICY "Allow read access to all profiles" ON profiles
  FOR SELECT USING (true);

-- Allow users to insert their own profile
CREATE POLICY "Allow users to insert their own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Allow users to update their own profile
CREATE POLICY "Allow users to update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Allow users to delete their own profile
CREATE POLICY "Allow users to delete their own profile" ON profiles
  FOR DELETE USING (auth.uid() = id);

-- VIDEOS TABLE POLICIES
-- Allow users to read all videos (for discovery)
CREATE POLICY "Allow read access to all videos" ON videos
  FOR SELECT USING (true);

-- Allow authenticated users to insert videos
CREATE POLICY "Allow authenticated users to insert videos" ON videos
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Allow users to update their own videos
CREATE POLICY "Allow users to update their own videos" ON videos
  FOR UPDATE USING (auth.uid() = user_id);

-- Allow users to delete their own videos
CREATE POLICY "Allow users to delete their own videos" ON videos
  FOR DELETE USING (auth.uid() = user_id);

-- ORDERS TABLE POLICIES
-- Allow users to read their own orders
CREATE POLICY "Allow users to read their own orders" ON orders
  FOR SELECT USING (auth.uid() = user_id);

-- Allow authenticated users to insert orders
CREATE POLICY "Allow authenticated users to insert orders" ON orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Allow users to update their own orders
CREATE POLICY "Allow users to update their own orders" ON orders
  FOR UPDATE USING (auth.uid() = user_id);

-- Allow business owners to read orders for their videos
CREATE POLICY "Allow business owners to read orders for their videos" ON orders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM videos 
      WHERE videos.id = orders.video_id 
      AND videos.user_id = auth.uid()
    )
  );

-- EVENTS TABLE POLICIES
-- Allow users to read all public events
CREATE POLICY "Allow read access to public events" ON events
  FOR SELECT USING (is_public = true OR auth.uid() = user_id);

-- Allow authenticated users to insert events
CREATE POLICY "Allow authenticated users to insert events" ON events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Allow users to update their own events
CREATE POLICY "Allow users to update their own events" ON events
  FOR UPDATE USING (auth.uid() = user_id);

-- Allow users to delete their own events
CREATE POLICY "Allow users to delete their own events" ON events
  FOR DELETE USING (auth.uid() = user_id);

-- VOUCHERS TABLE POLICIES
-- Allow users to read all active vouchers
CREATE POLICY "Allow read access to active vouchers" ON vouchers
  FOR SELECT USING (is_active = true OR auth.uid() = business_id);

-- Allow business users to insert vouchers
CREATE POLICY "Allow business users to insert vouchers" ON vouchers
  FOR INSERT WITH CHECK (
    auth.uid() = business_id AND
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.user_type = 'business'
    )
  );

-- Allow business users to update their own vouchers
CREATE POLICY "Allow business users to update their own vouchers" ON vouchers
  FOR UPDATE USING (auth.uid() = business_id);

-- Allow business users to delete their own vouchers
CREATE POLICY "Allow business users to delete their own vouchers" ON vouchers
  FOR DELETE USING (auth.uid() = business_id);

-- RESERVATIONS TABLE POLICIES
-- Allow users to read their own reservations
CREATE POLICY "Allow users to read their own reservations" ON reservations
  FOR SELECT USING (auth.uid() = user_id);

-- Allow business owners to read reservations for their events/services
CREATE POLICY "Allow business owners to read their reservations" ON reservations
  FOR SELECT USING (
    auth.uid() = business_id OR
    EXISTS (
      SELECT 1 FROM events 
      WHERE events.id = reservations.event_id 
      AND events.user_id = auth.uid()
    ) OR
    EXISTS (
      SELECT 1 FROM videos 
      WHERE videos.id = reservations.video_id 
      AND videos.user_id = auth.uid()
    )
  );

-- Allow authenticated users to insert reservations
CREATE POLICY "Allow authenticated users to insert reservations" ON reservations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Allow users to update their own reservations
CREATE POLICY "Allow users to update their own reservations" ON reservations
  FOR UPDATE USING (auth.uid() = user_id);

-- Allow business owners to update reservations for their services
CREATE POLICY "Allow business owners to update their reservations" ON reservations
  FOR UPDATE USING (
    auth.uid() = business_id OR
    EXISTS (
      SELECT 1 FROM events 
      WHERE events.id = reservations.event_id 
      AND events.user_id = auth.uid()
    ) OR
    EXISTS (
      SELECT 1 FROM videos 
      WHERE videos.id = reservations.video_id 
      AND videos.user_id = auth.uid()
    )
  );

-- STORAGE POLICIES
-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Allow authenticated users to upload videos" ON storage.objects CASCADE;
DROP POLICY IF EXISTS "Allow public read access to videos" ON storage.objects CASCADE;
DROP POLICY IF EXISTS "Allow users to update their own videos" ON storage.objects CASCADE;
DROP POLICY IF EXISTS "Allow users to delete their own videos" ON storage.objects CASCADE;
DROP POLICY IF EXISTS "Allow authenticated users to upload images" ON storage.objects CASCADE;
DROP POLICY IF EXISTS "Allow public read access to images" ON storage.objects CASCADE;
DROP POLICY IF EXISTS "Allow users to update their own images" ON storage.objects CASCADE;
DROP POLICY IF EXISTS "Allow users to delete their own images" ON storage.objects CASCADE;
DROP POLICY IF EXISTS "Allow authenticated users to read buckets" ON storage.buckets CASCADE;
DROP POLICY IF EXISTS "Allow service role to manage buckets" ON storage.buckets CASCADE;
DROP POLICY IF EXISTS "Allow users to read bucket info" ON storage.buckets CASCADE;

-- Enable RLS on storage tables
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to upload to videos bucket
CREATE POLICY "Allow authenticated users to upload videos" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'videos' AND
    (auth.role() = 'authenticated' OR auth.role() = 'service_role')
  );

-- Allow public read access to videos
CREATE POLICY "Allow public read access to videos" ON storage.objects
  FOR SELECT USING (bucket_id = 'videos');

-- Allow users to update their own video files
CREATE POLICY "Allow users to update their own videos" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'videos' AND
    (auth.role() = 'authenticated' OR auth.role() = 'service_role')
  );

-- Allow users to delete their own video files
CREATE POLICY "Allow users to delete their own videos" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'videos' AND
    (auth.role() = 'authenticated' OR auth.role() = 'service_role')
  );

-- Allow authenticated users to upload to images bucket
CREATE POLICY "Allow authenticated users to upload images" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'images' AND
    (auth.role() = 'authenticated' OR auth.role() = 'service_role')
  );

-- Allow public read access to images
CREATE POLICY "Allow public read access to images" ON storage.objects
  FOR SELECT USING (bucket_id = 'images');

-- Allow users to update their own image files
CREATE POLICY "Allow users to update their own images" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'images' AND
    (auth.role() = 'authenticated' OR auth.role() = 'service_role')
  );

-- Allow users to delete their own image files
CREATE POLICY "Allow users to delete their own images" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'images' AND
    (auth.role() = 'authenticated' OR auth.role() = 'service_role')
  );

-- Allow authenticated users to read bucket information
CREATE POLICY "Allow authenticated users to read buckets" ON storage.buckets
  FOR SELECT USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Allow service role to manage buckets (for bucket creation)
CREATE POLICY "Allow service role to manage buckets" ON storage.buckets
  FOR ALL USING (auth.role() = 'service_role');

-- Allow anon and authenticated users to read bucket info (needed for uploads)
CREATE POLICY "Allow users to read bucket info" ON storage.buckets
  FOR SELECT USING (true);

-- Allow service role to create and manage buckets
CREATE POLICY "Allow service role to create buckets" ON storage.buckets
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Allow service role to manage all buckets
CREATE POLICY "Allow service role to manage all buckets" ON storage.buckets
  FOR ALL USING (auth.role() = 'service_role');

-- Allow public access to bucket metadata (needed for uploads)
CREATE POLICY "Allow public bucket metadata access" ON storage.buckets
  FOR SELECT USING (true);

-- Create function to handle profile creation on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  -- Only create profile if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.id) THEN
    INSERT INTO public.profiles (id, email, full_name, username, user_type, followers_count, following_count)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'),
      COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || substr(NEW.id, 1, 8)),
      COALESCE(NEW.raw_user_meta_data->>'user_type', 'private')::text,
      0,
      0
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically create profile on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Refresh the schema cache
NOTIFY pgrst, 'reload schema';