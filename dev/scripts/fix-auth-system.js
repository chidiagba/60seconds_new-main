// Fix Auth System - Clean Implementation
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://rvvujgbaswecqohixgog.supabase.co';
const supabaseAnonKey = 'CONFIGURE_SUPABASE_PUBLIC_KEY';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testSignup() {
  try {
    console.log('🧪 Testing Signup System...');
    
    // Test 1: Personal Account Signup
    console.log('\n1️⃣ Testing Personal Account Signup...');
    const personalEmail = `personal-${Date.now()}@test.com`;
    const personalPassword = 'testpassword123';
    
    const { data: personalData, error: personalError } = await supabase.auth.signUp({
      email: personalEmail,
      password: personalPassword,
    });
    
    if (personalError) {
      console.log('❌ Personal signup failed:', personalError.message);
    } else {
      console.log('✅ Personal signup successful:', personalData.user?.id);
      
      // Create profile for personal account
      if (personalData.user) {
        const { data: personalProfile, error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: personalData.user.id,
            email: personalEmail,
            full_name: 'Test Personal User',
            username: `personal${Date.now()}`,
            user_type: 'private',
            followers_count: 0,
            following_count: 0
          })
          .select()
          .single();
        
        if (profileError) {
          console.log('❌ Personal profile creation failed:', profileError.message);
        } else {
          console.log('✅ Personal profile created:', personalProfile.id);
        }
      }
    }
    
    // Test 2: Business Account Signup
    console.log('\n2️⃣ Testing Business Account Signup...');
    const businessEmail = `business-${Date.now()}@test.com`;
    const businessPassword = 'testpassword123';
    
    const { data: businessData, error: businessError } = await supabase.auth.signUp({
      email: businessEmail,
      password: businessPassword,
    });
    
    if (businessError) {
      console.log('❌ Business signup failed:', businessError.message);
    } else {
      console.log('✅ Business signup successful:', businessData.user?.id);
      
      // Create profile for business account
      if (businessData.user) {
        const { data: businessProfile, error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: businessData.user.id,
            email: businessEmail,
            full_name: 'Test Business Owner',
            username: `business${Date.now()}`,
            user_type: 'business',
            business_name: 'Test Business',
            business_type: 'Restaurant',
            followers_count: 0,
            following_count: 0
          })
          .select()
          .single();
        
        if (profileError) {
          console.log('❌ Business profile creation failed:', profileError.message);
        } else {
          console.log('✅ Business profile created:', businessProfile.id);
        }
      }
    }
    
    // Test 3: Sign In
    console.log('\n3️⃣ Testing Sign In...');
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: businessEmail,
      password: businessPassword,
    });
    
    if (signInError) {
      console.log('❌ Sign in failed:', signInError.message);
    } else {
      console.log('✅ Sign in successful:', signInData.user?.id);
      
      // Fetch profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', signInData.user.id)
        .single();
      
      if (profileError) {
        console.log('❌ Profile fetch failed:', profileError.message);
      } else {
        console.log('✅ Profile fetched:', {
          username: profile.username,
          full_name: profile.full_name,
          user_type: profile.user_type,
          business_name: profile.business_name
        });
      }
    }
    
    console.log('\n🎉 Auth system test completed!');
    
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
}

testSignup();





