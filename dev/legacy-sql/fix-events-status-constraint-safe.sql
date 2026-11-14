-- Fix Events Table Status Constraint - Safe Version
-- This script handles existing data that might have invalid status values

-- Step 1: First, let's see what status values currently exist
SELECT DISTINCT status, COUNT(*) as count 
FROM public.events 
GROUP BY status;

-- Step 2: Update any invalid status values to valid ones
-- Update 'active' to 'published' (most common case)
UPDATE public.events 
SET status = 'published' 
WHERE status = 'active';

-- Update any other invalid statuses to 'draft' as fallback
UPDATE public.events 
SET status = 'draft' 
WHERE status NOT IN ('draft', 'published', 'cancelled', 'completed');

-- Step 3: Now drop the existing constraint
ALTER TABLE public.events 
DROP CONSTRAINT IF EXISTS events_status_check;

-- Step 4: Add the new check constraint that matches the code
ALTER TABLE public.events 
ADD CONSTRAINT events_status_check 
CHECK (status IN ('draft', 'published', 'cancelled', 'completed'));

-- Step 5: Set default status to 'draft' to match the code expectations
ALTER TABLE public.events 
ALTER COLUMN status SET DEFAULT 'draft';

-- Step 6: Verify the fix worked
SELECT 'Events table status constraint has been updated successfully!' as message;
SELECT DISTINCT status, COUNT(*) as count 
FROM public.events 
GROUP BY status;
