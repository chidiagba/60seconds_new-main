// Create Products Table in Supabase
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://rvvujgbaswecqohixgog.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ2dnVqZ2Jhc3dlY3FvaGl4Z29nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk1NDc3NDUsImV4cCI6MjA1NTEyMzc0NX0.7tN4mfu7H6mYCTzGkCO6qzIoEzvIffa_iveNxXkJkXc';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function createProductsTable() {
  try {
    console.log('🔧 Creating products table...');
    
    // First, let's check if the table already exists
    const { data: existingTable, error: checkError } = await supabase
      .from('products')
      .select('count')
      .limit(1);
    
    if (!checkError) {
      console.log('✅ Products table already exists!');
      return;
    }
    
    console.log('❌ Products table does not exist. Creating it...');
    console.log('📝 Please run this SQL in your Supabase SQL Editor:');
    console.log('');
    console.log('-- Create products table');
    console.log('CREATE TABLE IF NOT EXISTS products (');
    console.log('  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),');
    console.log('  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,');
    console.log('  business_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,');
    console.log('  name TEXT NOT NULL,');
    console.log('  description TEXT,');
    console.log('  price DECIMAL(10,2) NOT NULL,');
    console.log('  currency TEXT DEFAULT \'USD\',');
    console.log('  type TEXT NOT NULL CHECK (type IN (\'ticket\', \'drink\', \'reservation\', \'merchandise\')),');
    console.log('  available_quantity INTEGER NOT NULL DEFAULT 0,');
    console.log('  sold_quantity INTEGER DEFAULT 0,');
    console.log('  image_url TEXT,');
    console.log('  is_active BOOLEAN DEFAULT TRUE,');
    console.log('  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),');
    console.log('  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()');
    console.log(');');
    console.log('');
    console.log('-- Enable RLS');
    console.log('ALTER TABLE products ENABLE ROW LEVEL SECURITY;');
    console.log('');
    console.log('-- Create policies');
    console.log('CREATE POLICY "Users can view active products" ON products');
    console.log('  FOR SELECT USING (is_active = true);');
    console.log('');
    console.log('CREATE POLICY "Business owners can manage their products" ON products');
    console.log('  FOR ALL USING (business_id = auth.uid());');
    console.log('');
    
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
}

createProductsTable();
























