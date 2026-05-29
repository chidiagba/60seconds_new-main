-- Complete database schema update for videos and events tables
-- Run this entire script in your Supabase Dashboard → SQL Editor

-- ============================================
-- 1. UPDATE VIDEOS TABLE
-- ============================================
ALTER TABLE public.videos 
ADD COLUMN IF NOT EXISTS likes_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS comments_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS shares_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS rating DECIMAL(3,2) DEFAULT 0.0,
ADD COLUMN IF NOT EXISTS rating_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS location_name TEXT,
ADD COLUMN IF NOT EXISTS location_city TEXT,
ADD COLUMN IF NOT EXISTS location_country TEXT,
ADD COLUMN IF NOT EXISTS location_coordinates TEXT,
ADD COLUMN IF NOT EXISTS event_name TEXT,
ADD COLUMN IF NOT EXISTS event_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS hashtags TEXT[],
ADD COLUMN IF NOT EXISTS upload_date TIMESTAMP WITH TIME ZONE;

-- Add indexes for videos table
CREATE INDEX IF NOT EXISTS idx_videos_likes_count ON public.videos(likes_count);
CREATE INDEX IF NOT EXISTS idx_videos_comments_count ON public.videos(comments_count);
CREATE INDEX IF NOT EXISTS idx_videos_rating ON public.videos(rating);
CREATE INDEX IF NOT EXISTS idx_videos_event_name ON public.videos(event_name);
CREATE INDEX IF NOT EXISTS idx_videos_event_date ON public.videos(event_date);
CREATE INDEX IF NOT EXISTS idx_videos_location_city ON public.videos(location_city);

-- ============================================
-- 2. UPDATE EVENTS TABLE
-- ============================================
ALTER TABLE public.events 
ADD COLUMN IF NOT EXISTS location_name TEXT,
ADD COLUMN IF NOT EXISTS location_address TEXT,
ADD COLUMN IF NOT EXISTS location_city TEXT,
ADD COLUMN IF NOT EXISTS location_state TEXT,
ADD COLUMN IF NOT EXISTS location_country TEXT,
ADD COLUMN IF NOT EXISTS location_latitude DECIMAL(10,8),
ADD COLUMN IF NOT EXISTS location_longitude DECIMAL(11,8),
ADD COLUMN IF NOT EXISTS max_attendees INTEGER DEFAULT 100,
ADD COLUMN IF NOT EXISTS current_attendees INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS ticket_price DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD',
ADD COLUMN IF NOT EXISTS image_url TEXT,
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General',
ADD COLUMN IF NOT EXISTS tags TEXT[],
ADD COLUMN IF NOT EXISTS hashtags TEXT[],
ADD COLUMN IF NOT EXISTS video_id TEXT,
ADD COLUMN IF NOT EXISTS business_id TEXT,
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';

-- Add indexes for events table
CREATE INDEX IF NOT EXISTS idx_events_video_id ON public.events(video_id);
CREATE INDEX IF NOT EXISTS idx_events_business_id ON public.events(business_id);
CREATE INDEX IF NOT EXISTS idx_events_hashtags ON public.events USING GIN(hashtags);
CREATE INDEX IF NOT EXISTS idx_events_tags ON public.events USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_events_location_city ON public.events(location_city);
CREATE INDEX IF NOT EXISTS idx_events_status ON public.events(status);
CREATE INDEX IF NOT EXISTS idx_events_is_public ON public.events(is_public);

-- ============================================
-- 3. UPDATE EXISTING RECORDS
-- ============================================
-- Update existing videos with default values
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

-- Update existing events with default values
UPDATE public.events 
SET 
  current_attendees = COALESCE(current_attendees, 0),
  max_attendees = COALESCE(max_attendees, 100),
  ticket_price = COALESCE(ticket_price, 0.00),
  currency = COALESCE(currency, 'USD'),
  category = COALESCE(category, 'General'),
  is_public = COALESCE(is_public, true),
  requires_approval = COALESCE(requires_approval, false),
  status = COALESCE(status, 'draft')
WHERE 
  current_attendees IS NULL 
  OR max_attendees IS NULL 
  OR ticket_price IS NULL 
  OR currency IS NULL 
  OR category IS NULL 
  OR is_public IS NULL 
  OR requires_approval IS NULL 
  OR status IS NULL;

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
SELECT 'Database schema updated successfully! Videos and events tables are now ready.' as message;
