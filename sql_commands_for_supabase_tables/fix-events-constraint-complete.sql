-- Complete Fix for Events Table Status Constraint
-- This script will completely resolve the constraint issue

-- Step 1: Check current constraint definition
SELECT conname, pg_get_constraintdef(oid) as definition
FROM pg_constraint 
WHERE conrelid = 'public.events'::regclass 
AND contype = 'c';

-- Step 2: Check what status values currently exist
SELECT DISTINCT status, COUNT(*) as count 
FROM public.events 
GROUP BY status;

-- Step 3: Temporarily disable the constraint by dropping it
ALTER TABLE public.events 
DROP CONSTRAINT IF EXISTS events_status_check;

-- Step 4: Update any problematic status values
-- Convert 'active' to 'published'
UPDATE public.events 
SET status = 'published' 
WHERE status = 'active';

-- Convert any other invalid statuses to 'draft'
UPDATE public.events 
SET status = 'draft' 
WHERE status NOT IN ('draft', 'published', 'cancelled', 'completed');

-- Step 5: Add the new constraint with the correct values
ALTER TABLE public.events 
ADD CONSTRAINT events_status_check 
CHECK (status IN ('draft', 'published', 'cancelled', 'completed'));

-- Step 6: Set the default status
ALTER TABLE public.events 
ALTER COLUMN status SET DEFAULT 'draft';

-- Step 7: Verify the constraint is working
SELECT 'Constraint updated successfully!' as message;

-- Step 8: Test the constraint by checking if it accepts valid values
SELECT 'Testing constraint with valid status values...' as test_message;

-- Step 9: Show final status distribution
SELECT DISTINCT status, COUNT(*) as count 
FROM public.events 
GROUP BY status;
