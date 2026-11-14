/**
 * Datatrans Payment Gateway Configuration
 * 
 * To get your Datatrans API keys:
 * 1. Sign up at https://admin.sandbox.datatrans.com/Login.jsp (for sandbox)
 * 2. Get your Merchant ID from the dashboard
 * 3. Get your API credentials (Password/Sign Key)
 * 4. Replace the placeholder values below
 */

export const DATATRANS_CONFIG = {
  // Your Datatrans Merchant ID
  // Merchant ID: 1110020919
  MERCHANT_ID: process.env.DATATRANS_MERCHANT_ID || '1110020919',
  
  // Your Datatrans Password (API Password)
  // This is used for authentication with Datatrans API
  PASSWORD: '', // Disabled provider; credentials must never be bundled
  
  // Datatrans API Base URL
  // Sandbox: https://api.sandbox.datatrans.com
  // Production: https://api.datatrans.com
  BASE_URL: process.env.DATATRANS_BASE_URL || 'https://api.datatrans.com',
  
  // Default currency for payments
  DEFAULT_CURRENCY: 'CHF',
  
  // Test mode flag - disabled for production
  IS_TEST_MODE: false,
  
  // Supported payment methods
  SUPPORTED_PAYMENT_METHODS: [
    'credit_card',
    'debit_card',
    'postfinance',
    'twint',
    'paypal',
    'apple_pay',
    'google_pay',
  ],
  
  // Supported currencies
  SUPPORTED_CURRENCIES: [
    'CHF', // Swiss Franc
    'EUR', // Euro
    'USD', // US Dollar
    'GBP', // British Pound
  ],
};

/**
 * Environment Variables (for backend/server use)
 * 
 * Add these to your .env file:
 * 
 * DATATRANS_MERCHANT_ID=1110020919
 * DATATRANS_PASSWORD=your_password_here
 * DATATRANS_BASE_URL=https://api.sandbox.datatrans.com
 */

export default DATATRANS_CONFIG;

