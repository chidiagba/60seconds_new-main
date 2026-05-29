-- Add missing columns to videos table for stats, ratings, and event data
-- These columns are referenced in the code but missing from the database schema

ALTER TABLE public.videos 
ADD COLUMN IF NOT EXISTS likes_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS comments_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS shares_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS rating DECIMAL(3,2) DEFAULT 0.0,
ADD COLUMN IF NOT EXISTS rating_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS location_address TEXT,
ADD COLUMN IF NOT EXISTS location_state TEXT,
ADD COLUMN IF NOT EXISTS location_city TEXT,
ADD COLUMN IF NOT EXISTS location_country TEXT,
ADD COLUMN IF NOT EXISTS location_coordinates TEXT,
ADD COLUMN IF NOT EXISTS event_name TEXT,
ADD COLUMN IF NOT EXISTS event_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS hashtags TEXT[],
ADD COLUMN IF NOT EXISTS upload_date TIMESTAMP WITH TIME ZONE;

-- Add indexes for better performance on these columns
CREATE INDEX IF NOT EXISTS idx_videos_likes_count ON public.videos(likes_count);
CREATE INDEX IF NOT EXISTS idx_videos_comments_count ON public.videos(comments_count);
CREATE INDEX IF NOT EXISTS idx_videos_rating ON public.videos(rating);
CREATE INDEX IF NOT EXISTS idx_videos_event_name ON public.videos(event_name);
CREATE INDEX IF NOT EXISTS idx_videos_event_date ON public.videos(event_date);
CREATE INDEX IF NOT EXISTS idx_videos_location_city ON public.videos(location_city);

-- Update existing records to have default values
UPDATE public.videos 
SET 
  likes_count = COALESCE(likes_count, 0),
  comments_count = COALESCE(comments_count, 0),
  shares_count = COALESCE(shares_count, 0),
  rating = COALESCE(rating, 0.0),
  rating_count = COALESCE(rating_count, 0),
  upload_date = COALESCE(upload_date, created_at)
WHERE 
  likes_count IS NULL 
  OR comments_count IS NULL 
  OR shares_count IS NULL 
  OR rating IS NULL 
  OR rating_count IS NULL
  OR upload_date IS NULL;
