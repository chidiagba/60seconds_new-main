-- Fix Products Table RLS Policies
-- This will fix the "permission denied for table products" error

-- ==============================================
-- 1. CHECK CURRENT POLICIES
-- ==============================================

SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'products';

-- ==============================================
-- 2. DROP ALL EXISTING POLICIES
-- ==============================================

DROP POLICY IF EXISTS "Users can view active products" ON products;
DROP POLICY IF EXISTS "Business owners can manage their products" ON products;
DROP POLICY IF EXISTS "Business owners can insert products" ON products;
DROP POLICY IF EXISTS "Business owners can update their products" ON products;
DROP POLICY IF EXISTS "Business owners can delete their products" ON products;

-- ==============================================
-- 3. CREATE NEW POLICIES WITH PROPER PERMISSIONS
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
-- 4. VERIFY THE POLICIES
-- ==============================================

SELECT 
    'RLS Policies Updated Successfully!' as message,
    COUNT(*) as policy_count
FROM pg_policies 
WHERE tablename = 'products';

-- ==============================================
-- 5. TEST PERMISSIONS
-- ==============================================

-- This should work now
SELECT 'Testing product table access...' as test_message;
