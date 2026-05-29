-- ==============================================
-- AUTOMATIC WALLET CREATION TRIGGER
-- 60Seconds App - Create wallets automatically on user signup
-- ==============================================
-- This script adds automatic wallet creation when users sign up
-- Run this in your Supabase SQL Editor AFTER running create-wallet-tables.sql

-- ==============================================
-- STEP 1: UPDATE EXISTING handle_new_user FUNCTION
-- ==============================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  -- Only create profile if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.id) THEN
    INSERT INTO public.profiles (id, email, full_name, username, user_type, followers_count, following_count)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'),
      COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || substr(NEW.id, 1, 8)),
      COALESCE(NEW.raw_user_meta_data->>'user_type', 'private')::text,
      0,
      0
    );
  END IF;
  
  -- Create wallet for the new user
  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = NEW.id) THEN
    INSERT INTO public.wallets (user_id, balance, currency, is_verified, is_active)
    VALUES (
      NEW.id,
      0.00,
      'USD',
      false,
      true
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================
-- STEP 2: CREATE WALLETS FOR EXISTING USERS
-- ==============================================

-- Create wallets for existing users who don't have one
INSERT INTO wallets (user_id, balance, currency, is_verified, is_active)
SELECT 
  p.id,
  0.00,
  'USD',
  false,
  true
FROM profiles p 
WHERE NOT EXISTS (
  SELECT 1 FROM wallets w WHERE w.user_id = p.id
);

-- ==============================================
-- COMPLETION MESSAGE
-- ==============================================

SELECT 
  '🎉 WALLET CREATION TRIGGER ADDED!' as status,
  'Wallets will now be created automatically when users sign up.' as message,
  'Existing users without wallets have been given wallets.' as next_step;











