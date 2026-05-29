-- Fix Events Table - Add Missing creator_id Column
-- This script fixes the "null value in column creator_id violates not-null constraint" error

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

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_events_creator_id ON public.events(creator_id);

-- Add foreign key constraint to ensure data integrity
ALTER TABLE public.events 
ADD CONSTRAINT fk_events_creator_id 
FOREIGN KEY (creator_id) REFERENCES auth.users(id) ON DELETE CASCADE;

SELECT 'Events table creator_id column has been added and fixed!' as message;
