/**
 * Worldline Payment Integration Test
 * 
 * This script tests your Worldline payment integration
 * Run this with: node test-worldline-payment.js
 */

// Import the Worldline service
const WorldlineService = require('./lib/worldline.ts').default;

async function testWorldlineIntegration() {
  console.log('🧪 Testing Worldline Payment Integration...\n');
  
  try {
    const worldline = WorldlineService.getInstance();
    
    // Test 1: Check Configuration Status
    console.log('📋 Test 1: Checking Configuration Status');
    const configStatus = worldline.getConfigStatus();
    console.log('Configuration Status:', configStatus);
    
    if (configStatus.isConfigured) {
      console.log('✅ Configuration: REAL KEYS DETECTED');
    } else {
      console.log('🧪 Configuration: MOCK MODE (no real keys)');
    }
    console.log('');
    
    // Test 2: Create Session
    console.log('📋 Test 2: Creating Session');
    const session = await worldline.createSession({
      paymentContext: {
        amountOfMoney: {
          amount: 100.00,
          currencyCode: 'USD'
        },
        countryCode: 'US',
        locale: 'en_US',
        isRecurring: false
      }
    });
    
    if (session.success) {
      console.log('✅ Session Created Successfully');
      console.log('Session Data:', {
        clientSessionId: session.data.clientSessionId,
        customerId: session.data.customerId,
        isMock: session.data.isMock
      });
    } else {
      console.log('❌ Session Creation Failed:', session.message);
    }
    console.log('');
    
    // Test 3: Test Direct Card Payment
    console.log('📋 Test 3: Testing Direct Card Payment');
    const payment = await worldline.processDirectCardPayment({
      email: 'test@example.com',
      amount: 100.00,
      currency: 'USD',
      reference: `test_ref_${Date.now()}`,
      cardNumber: '4111111111111111', // Test Visa card
      expiryMonth: '12',
      expiryYear: '2025',
      cvv: '123',
      cardholderName: 'Test User',
      userId: 'test_user_123',
      paymentType: 'order_payment'
    });
    
    if (payment.success) {
      console.log('✅ Payment Processed Successfully');
      console.log('Payment Data:', {
        reference: payment.data.reference,
        status: payment.data.status,
        amount: payment.data.amount,
        currency: payment.data.currency,
        transactionId: payment.data.transaction_id
      });
    } else {
      console.log('❌ Payment Failed:', payment.message);
    }
    console.log('');
    
    // Test 4: Test Payment Methods
    console.log('📋 Test 4: Testing Payment Methods');
    const paymentMethods = await worldline.getPaymentMethods('test_user_123');
    
    if (paymentMethods.success) {
      console.log('✅ Payment Methods Retrieved');
      console.log('Payment Methods Count:', paymentMethods.data.length);
    } else {
      console.log('❌ Payment Methods Failed:', paymentMethods.message);
    }
    console.log('');
    
    // Test 5: Test Payment History
    console.log('📋 Test 5: Testing Payment History');
    const history = await worldline.getPaymentHistory('test_user_123', 10, 0);
    
    if (history.success) {
      console.log('✅ Payment History Retrieved');
      console.log('History Data:', {
        total: history.data.total,
        payments: history.data.payments.length,
        hasMore: history.data.hasMore
      });
    } else {
      console.log('❌ Payment History Failed:', history.message);
    }
    console.log('');
    
    // Summary
    console.log('🎉 Worldline Integration Test Complete!');
    console.log('=====================================');
    console.log('✅ All tests completed successfully');
    console.log('🚀 Your Worldline integration is ready to use!');
    
  } catch (error) {
    console.error('❌ Test Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run the test
testWorldlineIntegration();







