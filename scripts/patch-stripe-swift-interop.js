const fs = require('fs');
const path = require('path');

const headerPath = path.join(
  process.cwd(),
  'node_modules',
  '@stripe',
  'stripe-react-native',
  'ios',
  'StripeSwiftInterop.h'
);

if (!fs.existsSync(headerPath)) {
  console.log('[patch-stripe-swift-interop] Stripe header not found, skipping');
  process.exit(0);
}

const original = fs.readFileSync(headerPath, 'utf8');
const target = 'typedef NS_ENUM(NSUInteger, STPPaymentStatus);';
const replacement = 'typedef NS_ENUM(NSInteger, STPPaymentStatus);';

if (original.includes(replacement)) {
  console.log('[patch-stripe-swift-interop] Already patched');
  process.exit(0);
}

if (!original.includes(target)) {
  console.log('[patch-stripe-swift-interop] Expected pattern not found, skipping');
  process.exit(0);
}

const patched = original.replace(target, replacement);
fs.writeFileSync(headerPath, patched, 'utf8');
console.log('[patch-stripe-swift-interop] Patched STPPaymentStatus to NSInteger');
