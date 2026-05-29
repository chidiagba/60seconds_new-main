-- Add product_id column to vouchers table
-- This script should be run in your Supabase SQL editor

ALTER TABLE vouchers 
ADD COLUMN IF NOT EXISTS product_id TEXT;

-- Add a comment to document the column
COMMENT ON COLUMN vouchers.product_id IS 'Optional reference to a specific product this voucher applies to';

-- You can optionally add a foreign key constraint if you have a products table
-- ALTER TABLE vouchers 
-- ADD CONSTRAINT fk_vouchers_product_id 
-- FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
