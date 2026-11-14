// Simple test to verify Paystack key
const PAYSTACK_PUBLIC_KEY = 'pk_test_68e53f7a99ce5d8585afe865674e5138ed896a53';

async function testPaystackKey() {
  console.log('🧪 Testing Paystack key...');
  console.log('🔑 Key:', PAYSTACK_PUBLIC_KEY);
  
  try {
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAYSTACK_PUBLIC_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'test@example.com',
        amount: 100, // 100 kobo = ₦1.00
        currency: 'NGN',
        reference: 'test_' + Date.now(),
      }),
    });
    
    console.log('📊 Response status:', response.status);
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Key is valid!');
      console.log('📋 Response:', result);
    } else {
      const errorData = await response.text();
      console.log('❌ Key validation failed!');
      console.log('📋 Error:', errorData);
      
      try {
        const errorJson = JSON.parse(errorData);
        if (errorJson.message === 'Invalid key') {
          console.log('🚨 CONFIRMED: The key is invalid!');
          console.log('💡 Please check your Paystack dashboard for the correct key');
        }
      } catch (parseError) {
        console.log('📋 Raw error:', errorData);
      }
    }
  } catch (error) {
    console.error('❌ Network error:', error.message);
  }
}

testPaystackKey();









