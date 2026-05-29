-- Safe Products Table Fix - Handles existing tables and policies
-- This script will work even if the table or policies already exist

-- ==============================================
-- 1. CREATE PRODUCTS TABLE (IF NOT EXISTS)
-- ==============================================

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  type TEXT NOT NULL CHECK (type IN ('ticket', 'drink', 'reservation', 'merchandise')),
  available_quantity INTEGER NOT NULL DEFAULT 0,
  sold_quantity INTEGER DEFAULT 0,
  image_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==============================================
-- 2. CREATE INDEXES (IF NOT EXISTS)
-- ==============================================

CREATE INDEX IF NOT EXISTS idx_products_event_id ON products(event_id);
CREATE INDEX IF NOT EXISTS idx_products_business_id ON products(business_id);
CREATE INDEX IF NOT EXISTS idx_products_type ON products(type);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);

-- ==============================================
-- 3. ENABLE RLS (IF NOT ALREADY ENABLED)
-- ==============================================

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- ==============================================
-- 4. DROP EXISTING POLICIES (IF THEY EXIST)
-- ==============================================

DROP POLICY IF EXISTS "Users can view active products" ON products;
DROP POLICY IF EXISTS "Business owners can manage their products" ON products;
DROP POLICY IF EXISTS "Business owners can insert products" ON products;
DROP POLICY IF EXISTS "Business owners can update their products" ON products;
DROP POLICY IF EXISTS "Business owners can delete their products" ON products;

-- ==============================================
-- 5. CREATE NEW POLICIES
-- ==============================================

-- Policy: Users can view all active products
CREATE POLICY "Users can view active products" ON products
  FOR SELECT USING (is_active = true);

-- Policy: Business owners can manage their own products
CREATE POLICY "Business owners can manage their products" ON products
  FOR ALL USING (business_id = auth.uid());

-- Policy: Business owners can insert products for their events
CREATE POLICY "Business owners can insert products" ON products
  FOR INSERT WITH CHECK (business_id = auth.uid());

-- Policy: Business owners can update their products
CREATE POLICY "Business owners can update their products" ON products
  FOR UPDATE USING (business_id = auth.uid());

-- Policy: Business owners can delete their products
CREATE POLICY "Business owners can delete their products" ON products
  FOR DELETE USING (business_id = auth.uid());

-- ==============================================
-- 6. VERIFY THE SETUP
-- ==============================================

SELECT 'Products table setup completed successfully!' as message;

-- Check if table exists and has data
SELECT 
  'Table exists' as status,
  COUNT(*) as row_count 
FROM products;

