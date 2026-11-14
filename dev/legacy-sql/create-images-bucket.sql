-- Create images bucket for product images
-- This script creates the images bucket and sets up proper RLS policies

-- Create the images bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'images',
  'images',
  true,
  52428800, -- 50MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to upload images
CREATE POLICY "Authenticated users can upload images" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'images');

-- Policy: Allow authenticated users to update their own images
CREATE POLICY "Users can update their own images" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'images' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Policy: Allow authenticated users to delete their own images
CREATE POLICY "Users can delete their own images" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'images' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Policy: Allow anyone to view images (public bucket)
CREATE POLICY "Anyone can view images" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'images');

-- Grant necessary permissions
GRANT ALL ON storage.objects TO authenticated;
GRANT SELECT ON storage.objects TO anon;




























