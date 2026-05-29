import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rvvujgbaswecqohixgog.supabase.co';
const supabaseKey = 'YOUR_SERVICE_ROLE_KEY'; // Use your Supabase service role key here
const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase;
