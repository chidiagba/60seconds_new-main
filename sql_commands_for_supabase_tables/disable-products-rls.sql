-- Temporarily disable RLS on products table
-- This will allow all operations until we can fix the policies properly

-- Disable RLS on products table
ALTER TABLE products DISABLE ROW LEVEL SECURITY;

-- Verify RLS is disabled
SELECT 
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables 
WHERE tablename = 'products';

-- Show message
SELECT 'RLS disabled on products table. You can now create products!' as message;





















