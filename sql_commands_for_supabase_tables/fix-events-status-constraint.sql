-- Fix Events Table Status Constraint
-- The database constraint only allows ('active', 'cancelled', 'completed') 
-- but the code is trying to insert 'published' and 'draft'

-- First, let's see what the current constraint is
-- Then we'll update it to match what the code expects

-- Drop the existing check constraint
ALTER TABLE public.events 
DROP CONSTRAINT IF EXISTS events_status_check;

-- Add the new check constraint that matches the code
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

SELECT 'Events table status constraint has been updated to match code expectations!' as message;
