-- Add ALL missing columns to events table for complete functionality
-- These columns are referenced in the code but missing from the database schema

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

-- Add indexes for better performance on these columns
CREATE INDEX IF NOT EXISTS idx_events_video_id ON public.events(video_id);
CREATE INDEX IF NOT EXISTS idx_events_business_id ON public.events(business_id);
CREATE INDEX IF NOT EXISTS idx_events_hashtags ON public.events USING GIN(hashtags);
CREATE INDEX IF NOT EXISTS idx_events_tags ON public.events USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_events_location_city ON public.events(location_city);
CREATE INDEX IF NOT EXISTS idx_events_status ON public.events(status);
CREATE INDEX IF NOT EXISTS idx_events_is_public ON public.events(is_public);

-- Add foreign key constraint for video_id if videos table exists
-- ALTER TABLE public.events 
-- ADD CONSTRAINT fk_events_video_id 
-- FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE SET NULL;

-- Add foreign key constraint for business_id if profiles table exists
-- ALTER TABLE public.events 
-- ADD CONSTRAINT fk_events_business_id 
-- FOREIGN KEY (business_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
