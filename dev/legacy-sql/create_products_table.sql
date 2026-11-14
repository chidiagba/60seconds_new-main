-- ==============================================
-- CREATE PRODUCTS TABLE FOR BUSINESS EVENTS
-- ==============================================
-- This script creates a products table to store products/services
-- that business accounts can add to their events

-- Create products table
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

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_products_event_id ON products(event_id);
CREATE INDEX IF NOT EXISTS idx_products_business_id ON products(business_id);
CREATE INDEX IF NOT EXISTS idx_products_type ON products(type);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);

-- Add RLS policies for products table
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

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

-- Add comment to document the table
COMMENT ON TABLE products IS 'Products and services that business accounts can offer at their events';
COMMENT ON COLUMN products.event_id IS 'Reference to the event this product belongs to';
COMMENT ON COLUMN products.business_id IS 'Reference to the business account that owns this product';
COMMENT ON COLUMN products.type IS 'Type of product: ticket, drink, reservation, or merchandise';
COMMENT ON COLUMN products.available_quantity IS 'Number of items available for purchase';
COMMENT ON COLUMN products.sold_quantity IS 'Number of items already sold';

