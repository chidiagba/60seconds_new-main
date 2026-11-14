-- Check the current status of the products table and RLS

-- 1. Check if RLS is enabled on products table
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables 
WHERE tablename = 'products';

-- 2. Check all existing policies on products table
SELECT 
    policyname,
    cmd,
    permissive,
    roles,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'products'
ORDER BY policyname;

-- 3. Check if the table exists and has data
SELECT 
    'Table exists' as status,
    COUNT(*) as row_count 
FROM products;

-- 4. Check table permissions for current user
SELECT 
    grantee,
    privilege_type,
    is_grantable
FROM information_schema.table_privileges 
WHERE table_name = 'products' 
AND table_schema = 'public';





















