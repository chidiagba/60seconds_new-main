-- Complete Events Table Fix
-- This script fixes ALL schema mismatches between the code and database

-- ============================================
-- 1. FIX STATUS CONSTRAINT
-- ============================================
-- Drop the existing check constraint that only allows ('active', 'cancelled', 'completed')
ALTER TABLE public.events 
DROP CONSTRAINT IF EXISTS events_status_check;

-- Add the new check constraint that matches the code expectations
ALTER TABLE public.events 
ADD CONSTRAINT events_status_check 
CHECK (status IN ('draft', 'published', 'cancelled', 'completed'));

-- Update any existing 'active' status to 'published' to match the new constraint
UPDATE public.events 
SET status = 'published' 
WHERE status = 'active';

-- Set default status to 'draft' to match the code expectations
ALTER TABLE public.events 
ALTER COLUMN status SET DEFAULT 'draft';

-- ============================================
-- 2. ADD MISSING COLUMNS
-- ============================================
-- Add all missing columns that the code expects
ALTER TABLE public.events 
ADD COLUMN IF NOT EXISTS location_name TEXT,
ADD COLUMN IF NOT EXISTS location_address TEXT,
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
ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN DEFAULT false;

-- ============================================
-- 3. ADD CREATOR_ID COLUMN (if not exists)
-- ============================================
-- Add the missing creator_id column to events table
ALTER TABLE public.events 
ADD COLUMN IF NOT EXISTS creator_id TEXT;

-- Set creator_id to user_id for existing records
UPDATE public.events 
SET creator_id = user_id 
WHERE creator_id IS NULL;

-- Make creator_id NOT NULL after setting values
ALTER TABLE public.events 
ALTER COLUMN creator_id SET NOT NULL;

-- ============================================
-- 4. ADD INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_events_video_id ON public.events(video_id);
CREATE INDEX IF NOT EXISTS idx_events_business_id ON public.events(business_id);
CREATE INDEX IF NOT EXISTS idx_events_creator_id ON public.events(creator_id);
CREATE INDEX IF NOT EXISTS idx_events_hashtags ON public.events USING GIN(hashtags);
CREATE INDEX IF NOT EXISTS idx_events_tags ON public.events USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_events_location_city ON public.events(location_city);
CREATE INDEX IF NOT EXISTS idx_events_status ON public.events(status);
CREATE INDEX IF NOT EXISTS idx_events_is_public ON public.events(is_public);

-- ============================================
-- 5. ADD FOREIGN KEY CONSTRAINTS
-- ============================================
-- Add foreign key constraint for creator_id
ALTER TABLE public.events 
ADD CONSTRAINT fk_events_creator_id 
FOREIGN KEY (creator_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add foreign key constraint for video_id if videos table exists
ALTER TABLE public.events 
ADD CONSTRAINT fk_events_video_id 
FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE SET NULL;

-- ============================================
-- 6. UPDATE EXISTING RECORDS
-- ============================================
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

SELECT 'Events table has been completely fixed and aligned with code expectations!' as message;
