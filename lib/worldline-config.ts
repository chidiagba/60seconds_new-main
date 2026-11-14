/**
 * Worldline Payment Gateway Configuration
 * 
 * To get your Worldline API keys:
 * 1. Sign up at https://developer.worldline-solutions.com/
 * 2. Create a new project/application
 * 3. Get your Merchant ID and API Key from the dashboard
 * 4. Replace the placeholder values below
 */

export const WORLDLINE_CONFIG = {
  // Your Worldline Merchant ID (PSPID from dashboard)
  // PSPID: 60secondsTechnologies
  MERCHANT_ID: process.env.WORLDLINE_MERCHANT_ID || '60secondsTechnologies',
  
  // Your Worldline Secret API Key (copied from dashboard - shown only once!)
  // API Key ID: 8F142108CB95DFDA64F6
  API_KEY: '', // Disabled provider; credentials must never be bundled
  
  // Worldline API Base URL
  // Sandbox: https://payment.preprod.direct.worldline-solutions.com/v2
  // Production: https://payment.direct.worldline-solutions.com/v2
  BASE_URL: process.env.WORLDLINE_BASE_URL || 'https://payment.direct.worldline-solutions.com/v2',
  
  // Default currency for payments
  DEFAULT_CURRENCY: 'USD',
  
  // Test mode flag - disabled for production
  IS_TEST_MODE: false,
  
  // Supported payment methods
  SUPPORTED_PAYMENT_METHODS: [
    'credit_card',
    'debit_card',
    'bank_transfer',
    'digital_wallet',
    'buy_now_pay_later',
    'bank_redirect',
  ],
  
  // Supported currencies
  SUPPORTED_CURRENCIES: [
    'USD', // US Dollar
    'EUR', // Euro
    'GBP', // British Pound
    'CHF', // Swiss Franc
    'CAD', // Canadian Dollar
    'AUD', // Australian Dollar
  ],
};

/**
 * Environment Variables (for backend/server use)
 * 
 * Add these to your .env file:
 * 
 * WORLDLINE_MERCHANT_ID=your_merchant_id_here
 * WORLDLINE_API_KEY=your_api_key_here
 * WORLDLINE_BASE_URL=https://api-sandbox.worldline-solutions.com
 */

export default WORLDLINE_CONFIG;


