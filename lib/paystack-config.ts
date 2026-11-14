// Paystack Configuration
// Replace these with your actual Paystack keys

export const PAYSTACK_CONFIG = {
  // Read from environment so test and live credentials can be injected per build.
  PUBLIC_KEY: process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY || 'pk_test_your_public_key_here',
  
  // Base URL for Paystack API
  BASE_URL: 'https://api.paystack.co',
  
  // Default currency
  DEFAULT_CURRENCY: 'NGN',
  
  // Test mode flag - disabled for production
  IS_TEST_MODE: false,
};

// Instructions:
// 1. Go to https://dashboard.paystack.com/#/settings/developers
// 2. Copy your Test Public Key (starts with pk_test_)
// 3. Replace 'pk_test_YOUR_ACTUAL_TEST_PUBLIC_KEY_HERE' with your actual key
// 4. Copy your Test Secret Key (starts with sk_test_)
// 5. Replace 'sk_test_YOUR_ACTUAL_TEST_SECRET_KEY_HERE' with your actual key
