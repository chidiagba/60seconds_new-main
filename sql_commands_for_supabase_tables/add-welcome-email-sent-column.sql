-- Add welcome_email_sent_at column to profiles table
-- This is used as a reliable guard to ensure the welcome email is only sent once.
-- The edge function stamps this column after the first successful send.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
