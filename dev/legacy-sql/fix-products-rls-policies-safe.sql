-- Safe Products Table RLS Policies Fix
-- This script handles existing policies and won't fail if they already exist

-- ==============================================
-- 1. DROP ALL EXISTING POLICIES (SAFELY)
-- ==============================================

DO $$ 
BEGIN
    -- Drop policies if they exist
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'products' AND policyname = 'Anyone can view active products') THEN
        DROP POLICY "Anyone can view active products" ON products;
        RAISE NOTICE 'Dropped policy: Anyone can view active products';
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'products' AND policyname = 'Authenticated users can insert products') THEN
        DROP POLICY "Authenticated users can insert products" ON products;
        RAISE NOTICE 'Dropped policy: Authenticated users can insert products';
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'products' AND policyname = 'Users can update their own products') THEN
        DROP POLICY "Users can update their own products" ON products;
        RAISE NOTICE 'Dropped policy: Users can update their own products';
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'products' AND policyname = 'Users can delete their own products') THEN
        DROP POLICY "Users can delete their own products" ON products;
        RAISE NOTICE 'Dropped policy: Users can delete their own products';
    END IF;
    
    -- Drop any other existing policies
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'products' AND policyname = 'Users can view active products') THEN
        DROP POLICY "Users can view active products" ON products;
        RAISE NOTICE 'Dropped policy: Users can view active products';
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'products' AND policyname = 'Business owners can manage their products') THEN
        DROP POLICY "Business owners can manage their products" ON products;
        RAISE NOTICE 'Dropped policy: Business owners can manage their products';
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'products' AND policyname = 'Business owners can insert products') THEN
        DROP POLICY "Business owners can insert products" ON products;
        RAISE NOTICE 'Dropped policy: Business owners can insert products';
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'products' AND policyname = 'Business owners can update their products') THEN
        DROP POLICY "Business owners can update their products" ON products;
        RAISE NOTICE 'Dropped policy: Business owners can update their products';
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'products' AND policyname = 'Business owners can delete their products') THEN
        DROP POLICY "Business owners can delete their products" ON products;
        RAISE NOTICE 'Dropped policy: Business owners can delete their products';
    END IF;
END $$;

-- ==============================================
-- 2. CREATE NEW POLICIES
-- ==============================================

-- Policy: Anyone can view active products
CREATE POLICY "Anyone can view active products" ON products
    FOR SELECT 
    USING (is_active = true);

-- Policy: Authenticated users can insert products
CREATE POLICY "Authenticated users can insert products" ON products
    FOR INSERT 
    WITH CHECK (auth.uid() IS NOT NULL);

-- Policy: Users can update their own products
CREATE POLICY "Users can update their own products" ON products
    FOR UPDATE 
    USING (business_id = auth.uid())
    WITH CHECK (business_id = auth.uid());

-- Policy: Users can delete their own products
CREATE POLICY "Users can delete their own products" ON products
    FOR DELETE 
    USING (business_id = auth.uid());

-- ==============================================
-- 3. VERIFY THE SETUP
-- ==============================================

SELECT 'Products RLS Policies Updated Successfully!' as message;

-- Show current policies
SELECT 
    policyname,
    cmd,
    qual
FROM pg_policies 
WHERE tablename = 'products'
ORDER BY policyname;
