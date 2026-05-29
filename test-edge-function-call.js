/**
 * ACTUAL TEST - Simulate what happens when app calls Edge Function
 * This will show the REAL error
 */

// Simulate Supabase client
const testSupabaseCall = async () => {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://rvvujgbaswecqohixgog.supabase.co';
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ2dnVqZ2Jhc3dlY3FvaGl4Z29nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk1NDc3NDUsImV4cCI6MjA1NTEyMzc0NX0.7tN4mfu7H6mYCTzGkCO6qzIoEzvIffa_iveNxXkJkXc';

  console.log('🧪 TESTING SUPABASE EDGE FUNCTION CALL\n');
  console.log('='.repeat(60));
  console.log(`Supabase URL: ${supabaseUrl}`);
  console.log('Function: datatrans-payment');
  console.log('='.repeat(60) + '\n');

  const testPayload = {
    email: "test@example.com",
    amount: 75,
    currency: "CHF",
    reference: "test_ref_" + Date.now(),
    cardNumber: "5555555555554444",
    expiryMonth: "12",
    expiryYear: "2025",
    cvv: "123",
    cardholderName: "Jane Smith",
    userId: "mock_user_1760885430874",
    paymentType: "wallet_funding",
    metadata: {}
  };

  console.log('📤 Request Payload:');
  console.log(JSON.stringify(testPayload, null, 2));
  console.log('\n');

  try {
    // Try to call the Edge Function directly via HTTP
    const functionUrl = `${supabaseUrl}/functions/v1/datatrans-payment`;
    console.log(`🌐 Calling: ${functionUrl}\n`);

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify(testPayload),
    });

    console.log(`📥 Response Status: ${response.status} ${response.statusText}`);
    console.log(`📥 Response Headers:`, Object.fromEntries(response.headers.entries()));
    console.log('\n');

    const contentType = response.headers.get('content-type');
    let responseData;

    if (contentType && contentType.includes('application/json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    console.log('📥 Response Body:');
    console.log(typeof responseData === 'string' ? responseData : JSON.stringify(responseData, null, 2));
    console.log('\n');

    if (!response.ok) {
      console.error('❌ ERROR DETECTED:');
      console.error(`   Status: ${response.status}`);
      console.error(`   Status Text: ${response.statusText}`);
      console.error(`   Response:`, responseData);
      
      // Extract error message
      let errorMsg = 'Unknown error';
      if (typeof responseData === 'object' && responseData) {
        if (responseData.message) errorMsg = responseData.message;
        else if (responseData.error) errorMsg = responseData.error;
        else errorMsg = JSON.stringify(responseData);
      } else if (typeof responseData === 'string') {
        errorMsg = responseData;
      }
      
      console.error(`\n💡 Actual Error Message: ${errorMsg}`);
      
      if (response.status === 404) {
        console.error('\n🚨 ROOT CAUSE: Edge Function not deployed!');
        console.error('   Solution: Deploy the function first');
        console.error('   Command: supabase functions deploy datatrans-payment');
      } else if (response.status === 500) {
        console.error('\n🚨 ROOT CAUSE: Edge Function has an error!');
        console.error('   Check: Supabase Dashboard → Edge Functions → Logs');
      } else if (response.status === 401 || response.status === 403) {
        console.error('\n🚨 ROOT CAUSE: Authentication issue!');
        console.error('   Check: Supabase API key and function permissions');
      }
    } else {
      console.log('✅ SUCCESS! Edge Function responded correctly');
    }

  } catch (error) {
    console.error('\n❌ NETWORK ERROR:');
    console.error('   Message:', error.message);
    console.error('   Stack:', error.stack);
    
    if (error.message.includes('fetch')) {
      console.error('\n🚨 ROOT CAUSE: Cannot reach Supabase!');
      console.error('   Check: Internet connection and Supabase URL');
    }
  }
};

// Run the test
testSupabaseCall().catch(console.error);


