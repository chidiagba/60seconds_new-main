-- ==============================================
-- PRODUCTION-READY SUPABASE SCHEMA
-- 60Seconds App - Complete Database Setup
-- ==============================================
-- This script creates a production-ready database schema with proper constraints,
-- relationships, and RLS policies for the 60Seconds app

-- ==============================================
-- STEP 1: DROP EXISTING TABLES (if they exist)
-- ==============================================

-- Drop tables in correct order (respecting foreign key constraints)
DROP TABLE IF EXISTS reservations CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS vouchers CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS videos CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- ==============================================
-- STEP 2: CREATE PROFILES TABLE
-- ==============================================

CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  user_type TEXT NOT NULL CHECK (user_type IN ('private', 'business')),
  business_name TEXT,
  business_type TEXT,
  location_city TEXT,
  hashtags TEXT[],
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  role TEXT DEFAULT 'user',
  welcome_email_sent_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

-- ==============================================
-- STEP 3: CREATE VIDEOS TABLE
-- ==============================================

CREATE TABLE videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  video_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  file_path TEXT,
  public_url TEXT,
  location_city TEXT,
  hashtags TEXT[],
  business_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==============================================
-- STEP 4: CREATE EVENTS TABLE
-- ==============================================

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  description TEXT,
  start_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE,
  location TEXT,
  location_city TEXT,
  location_latitude DECIMAL(10, 8),
  location_longitude DECIMAL(11, 8),
  max_attendees INTEGER DEFAULT 100,
  current_attendees INTEGER DEFAULT 0,
  ticket_price DECIMAL(10,2) DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  image_url TEXT,
  category TEXT DEFAULT 'General',
  hashtags TEXT[],
  is_public BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'completed')),
  video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
  business_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==============================================
-- STEP 5: CREATE RESERVATIONS TABLE
-- ==============================================

CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reserver_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
  business_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  description TEXT,
  amount DECIMAL(10,2) DEFAULT 0,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  reservation_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  confirmation_code TEXT UNIQUE NOT NULL DEFAULT UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8)),
  party_size INTEGER DEFAULT 1,
  special_requests TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded')),
  hashtags TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==============================================
-- STEP 6: CREATE VOUCHERS TABLE
-- ==============================================

CREATE TABLE vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  name TEXT,
  description TEXT,
  discount_amount DECIMAL(10,2),
  discount_percentage DECIMAL(5,2),
  min_purchase_amount DECIMAL(10,2) DEFAULT 0,
  max_discount_amount DECIMAL(10,2),
  usage_limit INTEGER DEFAULT 100,
  usage_count INTEGER DEFAULT 0,
  expiry_date TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  location_city TEXT,
  hashtags TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==============================================
-- STEP 7: CREATE ORDERS TABLE
-- ==============================================

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  order_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  items JSONB,
  payment_method TEXT,
  total_amount DECIMAL(10,2) DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  business_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==============================================
-- STEP 8: CREATE INDEXES FOR PERFORMANCE
-- ==============================================

-- Profiles indexes
CREATE INDEX idx_profiles_username ON profiles(username);
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_profiles_user_type ON profiles(user_type);

-- Videos indexes
CREATE INDEX idx_videos_user_id ON videos(user_id);
CREATE INDEX idx_videos_status ON videos(status);
CREATE INDEX idx_videos_created_at ON videos(created_at DESC);

-- Events indexes
CREATE INDEX idx_events_user_id ON events(user_id);
CREATE INDEX idx_events_creator_id ON events(creator_id);
CREATE INDEX idx_events_start_date ON events(start_date);
CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_is_public ON events(is_public);

-- Reservations indexes
CREATE INDEX idx_reservations_user_id ON reservations(user_id);
CREATE INDEX idx_reservations_event_id ON reservations(event_id);
CREATE INDEX idx_reservations_confirmation_code ON reservations(confirmation_code);
CREATE INDEX idx_reservations_status ON reservations(status);

-- Vouchers indexes
CREATE INDEX idx_vouchers_business_id ON vouchers(business_id);
CREATE INDEX idx_vouchers_code ON vouchers(code);
CREATE INDEX idx_vouchers_is_active ON vouchers(is_active);
CREATE INDEX idx_vouchers_expiry_date ON vouchers(expiry_date);

-- Orders indexes
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_event_id ON orders(event_id);
CREATE INDEX idx_orders_status ON orders(status);

-- ==============================================
-- STEP 9: CREATE UPDATED_AT TRIGGER FUNCTION
-- ==============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==============================================
-- STEP 10: CREATE TRIGGERS
-- ==============================================

-- Create triggers for updated_at columns
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_videos_updated_at
  BEFORE UPDATE ON videos
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reservations_updated_at
  BEFORE UPDATE ON reservations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vouchers_updated_at
  BEFORE UPDATE ON vouchers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ==============================================
-- STEP 11: ENABLE ROW LEVEL SECURITY
-- ==============================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- ==============================================
-- STEP 12: CREATE RLS POLICIES
-- ==============================================

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;

DROP POLICY IF EXISTS "Users can view all videos" ON videos;
DROP POLICY IF EXISTS "Users can view own videos" ON videos;
DROP POLICY IF EXISTS "Users can update own videos" ON videos;
DROP POLICY IF EXISTS "Users can insert own videos" ON videos;

DROP POLICY IF EXISTS "Users can view all events" ON events;
DROP POLICY IF EXISTS "Users can view own events" ON events;
DROP POLICY IF EXISTS "Users can update own events" ON events;
DROP POLICY IF EXISTS "Users can insert own events" ON events;

DROP POLICY IF EXISTS "Users can view all reservations" ON reservations;
DROP POLICY IF EXISTS "Users can view own reservations" ON reservations;
DROP POLICY IF EXISTS "Users can update own reservations" ON reservations;
DROP POLICY IF EXISTS "Users can insert own reservations" ON reservations;

DROP POLICY IF EXISTS "Users can view all vouchers" ON vouchers;
DROP POLICY IF EXISTS "Users can view own vouchers" ON vouchers;
DROP POLICY IF EXISTS "Users can update own vouchers" ON vouchers;
DROP POLICY IF EXISTS "Users can insert own vouchers" ON vouchers;

DROP POLICY IF EXISTS "Users can view all orders" ON orders;
DROP POLICY IF EXISTS "Users can view own orders" ON orders;
DROP POLICY IF EXISTS "Users can update own orders" ON orders;
DROP POLICY IF EXISTS "Users can insert own orders" ON orders;

-- Profiles RLS Policies
CREATE POLICY "Users can view all profiles" ON profiles 
FOR SELECT USING (true);

CREATE POLICY "Users can view own profile" ON profiles 
FOR SELECT USING (auth.uid()::text = id::text);

CREATE POLICY "Users can update own profile" ON profiles 
FOR UPDATE USING (auth.uid()::text = id::text);

CREATE POLICY "Users can insert own profile" ON profiles 
FOR INSERT WITH CHECK (auth.uid()::text = id::text);

-- Videos RLS Policies
CREATE POLICY "Users can view all videos" ON videos 
FOR SELECT USING (status = 'published');

CREATE POLICY "Users can view own videos" ON videos 
FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can update own videos" ON videos 
FOR UPDATE USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can insert own videos" ON videos 
FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

-- Events RLS Policies
CREATE POLICY "Users can view all events" ON events 
FOR SELECT USING (is_public = true AND status = 'active');

CREATE POLICY "Users can view own events" ON events 
FOR SELECT USING (auth.uid()::text = user_id::text OR auth.uid()::text = creator_id::text);

CREATE POLICY "Users can update own events" ON events 
FOR UPDATE USING (auth.uid()::text = user_id::text OR auth.uid()::text = creator_id::text);

CREATE POLICY "Users can insert own events" ON events 
FOR INSERT WITH CHECK (auth.uid()::text = user_id::text AND auth.uid()::text = creator_id::text);

-- Vouchers RLS Policies
CREATE POLICY "Users can view all vouchers" ON vouchers 
FOR SELECT USING (is_active = true);

CREATE POLICY "Users can view own vouchers" ON vouchers 
FOR SELECT USING (auth.uid()::text = business_id::text OR auth.uid()::text = creator_id::text);

CREATE POLICY "Users can update own vouchers" ON vouchers 
FOR UPDATE USING (auth.uid()::text = business_id::text OR auth.uid()::text = creator_id::text);

CREATE POLICY "Users can insert own vouchers" ON vouchers 
FOR INSERT WITH CHECK (auth.uid()::text = business_id::text AND auth.uid()::text = creator_id::text);

-- Reservations RLS Policies
CREATE POLICY "Users can view all reservations" ON reservations 
FOR SELECT USING (true);

CREATE POLICY "Users can view own reservations" ON reservations 
FOR SELECT USING (auth.uid()::text = user_id::text OR auth.uid()::text = reserver_id::text);

CREATE POLICY "Users can update own reservations" ON reservations 
FOR UPDATE USING (auth.uid()::text = user_id::text OR auth.uid()::text = reserver_id::text);

CREATE POLICY "Users can insert own reservations" ON reservations 
FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

-- Orders RLS Policies
CREATE POLICY "Users can view all orders" ON orders 
FOR SELECT USING (true);

CREATE POLICY "Users can view own orders" ON orders 
FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can update own orders" ON orders 
FOR UPDATE USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can insert own orders" ON orders 
FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

-- ==============================================
-- STEP 13: GRANT PERMISSIONS
-- ==============================================

-- Grant permissions to authenticated users
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- Grant read permissions to anonymous users for public data
GRANT SELECT ON profiles TO anon;
GRANT SELECT ON videos TO anon;
GRANT SELECT ON events TO anon;
GRANT SELECT ON vouchers TO anon;

-- ==============================================
-- COMPLETION MESSAGE
-- ==============================================

SELECT 
  '🎉 PRODUCTION SCHEMA SETUP COMPLETE!' as status,
  'All tables, relationships, indexes, triggers, and RLS policies have been created successfully.' as message,
  'Your database is now ready for production use!' as next_step;
