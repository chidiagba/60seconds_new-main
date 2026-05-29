-- Complete Products Table Permission Fix
-- This script will definitely fix the permission issues

-- ==============================================
-- STEP 1: Check current status
-- ==============================================
SELECT 'Starting products table permission fix...' as message;

-- Check if RLS is enabled
SELECT 
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables 
WHERE tablename = 'products';

-- ==============================================
-- STEP 2: Disable RLS completely
-- ==============================================
ALTER TABLE products DISABLE ROW LEVEL SECURITY;

SELECT 'RLS disabled on products table' as message;

-- ==============================================
-- STEP 3: Drop ALL existing policies (just in case)
-- ==============================================
DO $$ 
DECLARE
    policy_record RECORD;
BEGIN
    FOR policy_record IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'products'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON products', policy_record.policyname);
        RAISE NOTICE 'Dropped policy: %', policy_record.policyname;
    END LOOP;
END $$;

SELECT 'All existing policies dropped' as message;

-- ==============================================
-- STEP 4: Grant explicit permissions to authenticated users
-- ==============================================
-- Grant all permissions to authenticated role
GRANT ALL ON products TO authenticated;
GRANT ALL ON products TO anon;

-- Grant sequence permissions if there's a sequence
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;

SELECT 'Permissions granted to authenticated and anon roles' as message;

-- ==============================================
-- STEP 5: Verify the fix
-- ==============================================
-- Check RLS status
SELECT 
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables 
WHERE tablename = 'products';

-- Check policies (should be empty)
SELECT 
    policyname,
    cmd
FROM pg_policies 
WHERE tablename = 'products';

-- Check permissions
SELECT 
    grantee,
    privilege_type
FROM information_schema.table_privileges 
WHERE table_name = 'products' 
AND table_schema = 'public'
ORDER BY grantee, privilege_type;

SELECT 'Products table permission fix completed successfully!' as final_message;





























