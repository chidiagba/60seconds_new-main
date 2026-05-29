// Load environment variables first
require('dotenv').config();

const { serve } = require('@hono/node-server');
const app = require('./backend/hono.ts').default;

const port = 3001;

// Get local IP for network access
const os = require('os');
const networkInterfaces = os.networkInterfaces();
let localIP = 'localhost';
for (const name of Object.keys(networkInterfaces)) {
  for (const iface of networkInterfaces[name]) {
    if (iface.family === 'IPv4' && !iface.internal) {
      localIP = iface.address;
      break;
    }
  }
  if (localIP !== 'localhost') break;
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🚀 Starting Worldline Payment Server...');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

// Check Worldline configuration
const WORLDLINE_MERCHANT_ID = process.env.WORLDLINE_MERCHANT_ID;
const WORLDLINE_API_KEY = process.env.WORLDLINE_API_KEY;
const WORLDLINE_BASE_URL = process.env.WORLDLINE_BASE_URL || 'https://payment.preprod.direct.worldline-solutions.com/v2';

console.log('🔑 Worldline Configuration:');
console.log(`   Base URL: ${WORLDLINE_BASE_URL}`);
console.log(`   Merchant ID: ${WORLDLINE_MERCHANT_ID ? WORLDLINE_MERCHANT_ID.substring(0, 10) + '...' : '❌ NOT SET'}`);
console.log(`   API Key: ${WORLDLINE_API_KEY ? WORLDLINE_API_KEY.substring(0, 10) + '...' : '❌ NOT SET'}`);
console.log('');

if (!WORLDLINE_MERCHANT_ID || WORLDLINE_MERCHANT_ID === 'your_merchant_id_here') {
  console.log('⚠️  WARNING: WORLDLINE_MERCHANT_ID not configured!');
  console.log('   Set it: export WORLDLINE_MERCHANT_ID=your_test_merchant_id');
  console.log('');
}

if (!WORLDLINE_API_KEY || WORLDLINE_API_KEY === 'your_api_key_here') {
  console.log('⚠️  WARNING: WORLDLINE_API_KEY not configured!');
  console.log('   Set it: export WORLDLINE_API_KEY=your_test_api_key');
  console.log('');
}

console.log('📡 Server Endpoints:');
console.log(`   Local: http://localhost:${port}`);
if (localIP !== 'localhost') {
  console.log(`   Network: http://${localIP}:${port}`);
}
console.log(`   TRPC: http://localhost:${port}/api/trpc`);
console.log('');
console.log('📱 For your Expo app, set:');
console.log(`   export EXPO_PUBLIC_RORK_API_BASE_URL=http://${localIP}:${port}`);
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ Server starting...');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

serve({
  fetch: app.fetch,
  port: port,
}, (info) => {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Server running on http://localhost:${info.port}`);
  console.log('🎯 Ready to handle Worldline payments!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('💡 Watch this terminal for payment logs:');
  console.log('   - Payment requests will show here');
  console.log('   - Worldline API responses will be logged');
  console.log('   - Check for ✅ success or ❌ error messages');
  console.log('');
});





