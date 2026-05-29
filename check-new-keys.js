// Check the new keys
const NEW_PUBLIC_KEY = 'pk_test_68e53f7a99ce5d8585afe865674e5138ed896a53';
const NEW_SECRET_KEY = 'sk_test_1833f8a7f9f11dee5e61e2cd8305c95fceb3d83a';

console.log('🔍 Checking New Paystack Keys...');
console.log('');

console.log('📋 NEW PUBLIC KEY:');
console.log('Key:', NEW_PUBLIC_KEY);
console.log('Length:', NEW_PUBLIC_KEY.length);
console.log('Expected length: ~70 characters');
console.log('Status:', NEW_PUBLIC_KEY.length >= 60 ? '✅ Good length' : '❌ Too short');
console.log('');

console.log('📋 NEW SECRET KEY:');
console.log('Key:', NEW_SECRET_KEY);
console.log('Length:', NEW_SECRET_KEY.length);
console.log('Expected length: ~70 characters');
console.log('Status:', NEW_SECRET_KEY.length >= 60 ? '✅ Good length' : '❌ Too short');
console.log('');

// Test the new secret key
console.log('🧪 Testing new secret key format...');
console.log('Starts with sk_test_:', NEW_SECRET_KEY.startsWith('sk_test_'));
console.log('Valid format:', NEW_SECRET_KEY.startsWith('sk_test_') && NEW_SECRET_KEY.length >= 60);









