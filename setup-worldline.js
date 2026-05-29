#!/usr/bin/env node

/**
 * Worldline Setup Script
 * 
 * This script helps you configure real Worldline API credentials
 * to enable live payments and see entries in your Worldline dashboard.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('🔧 Worldline API Setup');
console.log('=====================\n');

console.log('This script will help you configure real Worldline API credentials.');
console.log('You can get these from: https://developer.worldline-solutions.com/\n');

async function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function setupWorldline() {
  try {
    console.log('📋 Step 1: Get your Worldline credentials');
    console.log('1. Go to https://developer.worldline-solutions.com/');
    console.log('2. Sign up or log in to your account');
    console.log('3. Create a new project/application');
    console.log('4. Get your Merchant ID and API Key from the dashboard\n');

    const merchantId = await askQuestion('Enter your Worldline Merchant ID: ');
    const apiKey = await askQuestion('Enter your Worldline API Key: ');
    const useSandbox = await askQuestion('Use sandbox mode? (y/n) [y]: ') || 'y';

    if (!merchantId || !apiKey) {
      console.log('❌ Both Merchant ID and API Key are required!');
      process.exit(1);
    }

    // Create .env file
    const envContent = `# Worldline API Configuration
WORLDLINE_MERCHANT_ID=${merchantId}
WORLDLINE_API_KEY=${apiKey}
WORLDLINE_BASE_URL=${useSandbox.toLowerCase() === 'y' ? 'https://api-sandbox.worldline-solutions.com' : 'https://api.worldline-solutions.com'}

# Other environment variables...
NODE_ENV=development
`;

    const envPath = path.join(__dirname, '.env');
    fs.writeFileSync(envPath, envContent);

    console.log('\n✅ Configuration saved to .env file!');
    console.log('\n📋 Next steps:');
    console.log('1. Restart your development server');
    console.log('2. Test a payment - it should now use real Worldline API');
    console.log('3. Check your Worldline dashboard for payment entries');
    console.log('\n🔗 Worldline Dashboard URLs:');
    console.log(`- Sandbox: https://merchant-portal.preprod.worldline-solutions.com`);
    console.log(`- Production: https://merchant-portal.worldline-solutions.com`);

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
  } finally {
    rl.close();
  }
}

// Check if .env already exists
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  console.log('⚠️  .env file already exists!');
  askQuestion('Do you want to overwrite it? (y/n) [n]: ').then((answer) => {
    if (answer.toLowerCase() === 'y') {
      setupWorldline();
    } else {
      console.log('Setup cancelled.');
      rl.close();
    }
  });
} else {
  setupWorldline();
}






