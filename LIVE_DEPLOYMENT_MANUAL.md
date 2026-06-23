# 🚀 Live Production Deployment - Step by Step

**Target:** iOS & Android App Stores  
**Version:** 88.0.0 (iOS) | versionCode 88 (Android)  
**Backend:** Supabase Edge Functions (No separate server needed)  
**Payment Settlement:** Live via paystack-webhook-settlement edge function

---

## ✅ Pre-Deployment Checklist

Before starting, verify:

- [ ] **Paystack Dashboard** - Webhook URL configured to: `https://rvvujgbaswecqohixgog.supabase.co/functions/v1/paystack-webhook-settlement`
- [ ] **App Versions** - Verified v88.0.0 in app.json (iOS: buildNumber 88, Android: versionCode 88)
- [ ] **EAS Account** - Logged in and project linked
- [ ] **Apple Developer** - Account active with team ID and certificates
- [ ] **Google Play** - Account active with upload key configured
- [ ] **Database** - Supabase verified and all edge functions ACTIVE
- [ ] **Git** - All changes committed and pushed to main branch

---

## 🎯 Option 1: Automated Deployment (Recommended)

### Step 1: Run the Deployment Script

```bash
cd /Users/mac/60seconds_new-main

# Deploy both iOS and Android
./deploy-production.sh both

# OR deploy individually
./deploy-production.sh ios    # iOS only
./deploy-production.sh android # Android only
```

**What the script does:**
1. ✅ Verifies prerequisites (Node.js, EAS CLI, git)
2. ✅ Validates version numbers in app.json
3. ✅ Commits version changes to git
4. ✅ Submits builds to EAS
5. ✅ Provides build monitoring link

**Expected Output:**
```
[✓] Node.js v18.x.x
[✓] npm v9.x.x
[✓] EAS CLI ready
[✓] Checking Prerequisites complete
[✓] All versions verified: 88.0.0 (code: 88)
[✓] Changes committed and pushed
[✓] iOS build submitted successfully
[✓] Android build submitted successfully

Next Steps:
1. Monitor builds: https://expo.dev/builds
2. Wait for builds to complete (~15 minutes each)
3. Download artifacts and submit to stores
```

### Step 2: Monitor Builds

Visit: **https://expo.dev/builds**

**Wait for:**
- iOS build: ~10-15 minutes
- Android build: ~10-15 minutes

Once complete, each will show:
- Build ID: `eas-build-xxxxxxx`
- Status: ✅ **COMPLETED**
- Download links (`.ipa` for iOS, `.aab` for Android)

---

## 🎯 Option 2: Manual Deployment (Step by Step)

### Step 1: Verify Versions

```bash
cd /Users/mac/60seconds_new-main

# Check current versions
jq '.expo | {version, ios_build: .ios.buildNumber, android_versionCode: .android.versionCode}' app.json

# Expected output:
# {
#   "version": "88.0.0",
#   "ios_build": "88",
#   "android_versionCode": 88
# }
```

### Step 2: Commit & Push

```bash
cd /Users/mac/60seconds_new-main

# Add all changes
git add app.json eas.json

# Commit
git commit -m "chore: bump app version to 88.0.0 for Supabase payment production deployment"

# Push to main
git push origin main
```

### Step 3: Login to EAS

```bash
eas login
# Enter your EAS account credentials
```

### Step 4: Build iOS

```bash
cd /Users/mac/60seconds_new-main

eas build \
  --platform ios \
  --profile production \
  --message "Production: Supabase payment settlement v88.0.0" \
  --non-interactive

# Or interactive (shows progress)
eas build --platform ios --profile production
```

**Wait for iOS build to complete (~15 min)**

### Step 5: Build Android

```bash
cd /Users/mac/60seconds_new-main

eas build \
  --platform android \
  --profile production \
  --message "Production: Supabase payment settlement v88.0.0" \
  --non-interactive

# Or interactive
eas build --platform android --profile production
```

**Wait for Android build to complete (~15 min)**

---

## 📱 Step 3: Submit to App Stores

### iOS: Submit to App Store

**Option A: Via Xcode (Manual)**

```bash
# 1. Download .ipa from EAS build
# https://expo.dev/builds → Select iOS build → Download

# 2. Open Xcode
open -a Xcode

# 3. Go to Window → Organizer
# 4. Select app → Upload to App Store

# 5. Fill in release info:
#    - Release notes: "Production deployment with Supabase payment settlement"
#    - Version: 88.0.0
#    - Category: Entertainment
#    - Rating: [select appropriate rating]
```

**Option B: Via EAS Submit**

```bash
eas submit --platform ios --latest --non-interactive
```

**Review Timeline:** 24-48 hours

### Android: Submit to Google Play

**Option A: Via Google Play Console (Manual)**

```bash
# 1. Download .aab from EAS build
# https://expo.dev/builds → Select Android build → Download .aab

# 2. Go to Google Play Console
# https://play.google.com/console

# 3. Select app → Release → Create New Release

# 4. Upload .aab file

# 5. Fill in release notes:
#    "Production deployment: Supabase payment settlement, idempotent tickets, automatic stock decrement"

# 6. Set rollout strategy:
#    - Start with 10% (staging)
#    - Wait 2-4 hours for monitoring
#    - Increase to 50% (staged)
#    - Wait 2-4 hours
#    - Roll out to 100% (production)
```

**Option B: Via EAS Submit**

```bash
eas submit --platform android --latest --non-interactive
```

**Review Timeline:** Usually instant for staged rollout

---

## 🧪 Step 4: Live Testing (Critical!)

### Before Full Rollout (on 10% staging)

#### Test 1: ProductList Single Purchase (Android)

**Device:** Android phone/tablet with app v88.0.0

```
1. Launch 60Seconds app
2. Go to Profile → Sign in as TEST ORGANIZER
3. Create test product:
   - Name: "Test Single Purchase - NGN 500"
   - Price: 500
   - Quantity: 10
   - Save

4. Sign out and sign in as TEST BUYER (different account)

5. Go to ProductList (Home)

6. Find "Test Single Purchase - NGN 500"

7. Tap "Buy Now"

8. Select "Pay with Paystack" → "Initialize"

9. Complete Paystack checkout:
   - Card: 4111111111111111
   - PIN: 123456
   - OTP: 123456 (if prompted)
   - Amount should be: NGN 500.00

10. Wait for success screen

11. Verify in Supabase:
```

```sql
-- Run these queries in Supabase SQL Editor
-- Check order was created
SELECT id, total_amount, status, created_at 
FROM orders 
WHERE buyer_id = 'test-buyer-id' 
ORDER BY created_at DESC 
LIMIT 1;

-- Check ticket was issued
SELECT order_id, product_id, quantity, status, created_at
FROM ticket_receipts
WHERE order_id = 'test-order-id';

-- Check settlement
SELECT order_id, amount, entry, created_at
FROM transactions
WHERE order_id = 'test-order-id'
ORDER BY created_at;

-- Check stock decreased
SELECT id, available_quantity, sold_quantity
FROM products
WHERE id = 'test-product-id';
```

**Expected Results:**
- ✅ Order created with status `settled` or `completed`
- ✅ 1 ticket_receipt created with status `issued`
- ✅ 2 transactions: 1 `owner_credit` (organizer 96% after 1.5% fee) + 1 `buyer_debit`
- ✅ Product: `available_quantity` decreased by 1, `sold_quantity` increased by 1
- ✅ Settlement happens within 1-5 seconds (webhook lag)

#### Test 2: Cart Multi-Item Purchase (iOS)

**Device:** iOS phone/tablet with app v88.0.0

```
1. Launch 60Seconds app (v88.0.0)

2. Sign in as TEST BUYER

3. Create products (as organizer first if needed):
   - "Cart Item A - NGN 200" (qty 5)
   - "Cart Item B - NGN 300" (qty 5)

4. Go to ProductList

5. Add 2× "Cart Item A" to cart
6. Add 1× "Cart Item B" to cart

7. Open Cart

8. Verify total: NGN 700 (2×200 + 1×300)

9. Tap "Checkout with Paystack"

10. Complete Paystack payment (4111111111111111)

11. Wait for success screen

12. Verify in Supabase:
```

```sql
-- Check order created
SELECT id, total_amount, status FROM orders 
WHERE buyer_id = 'test-buyer-ios' 
ORDER BY created_at DESC LIMIT 1;

-- Check multiple tickets created
SELECT product_id, COUNT(*) as ticket_count 
FROM ticket_receipts 
WHERE order_id = 'test-order-id' 
GROUP BY product_id;

-- Verify both products decremented
SELECT id, sold_quantity, available_quantity 
FROM products 
WHERE id IN ('cart-item-a-id', 'cart-item-b-id');
```

**Expected Results:**
- ✅ 1 order with NGN 700 total
- ✅ 3 tickets: 2 for Item A, 1 for Item B
- ✅ Item A: sold_quantity +2
- ✅ Item B: sold_quantity +1

#### Test 3: Webhook Verification

```bash
# Check Supabase function logs
curl "https://rvvujgbaswecqohixgog.supabase.co/functions/v1/paystack-webhook-settlement?logs=true" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ2dnVqZ2Jhc3dlY3FvaGl4Z29nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk1NDc3NDUsImV4cCI6MjA1NTEyMzc0NX0.7tN4mfu7H6mYCTzGkCO6qzIoEzvIffa_iveNxXkJkXc"

# Or via Supabase Dashboard:
# https://supabase.com/dashboard/project/rvvujgbaswecqohixgog/functions
# → Click paystack-webhook-settlement
# → View Logs tab
```

**Look for:**
- ✅ No error status codes (should be 200)
- ✅ Successful settlement messages
- ✅ Zero failed webhook processing
- ✅ Timestamp within 1-5 seconds of payment completion

---

## ⚠️ If Issues Occur

### Pause Rollout

```bash
# Android: In Google Play Console
# Release Management → Your Release
# Set rollout to 0% (pauses distribution)

# iOS: In App Store Connect
# App Store → Version Release
# Hold or remove from sale
```

### Check Logs

```bash
# Supabase Edge Function Logs
# https://supabase.com/dashboard/project/rvvujgbaswecqohixgog/functions
# → paystack-webhook-settlement → Logs

# Look for errors like:
# - "Invalid signature" (webhook auth issue)
# - "Order not found" (settlement error)
# - "Ticket creation failed" (idempotency issue)
```

### Rollback

```bash
# Option 1: Remove from stores (immediate)
# iOS: Remove from sale in App Store Connect
# Android: Set rollout to 0% in Google Play Console

# Option 2: Revert code and redeploy
cd /Users/mac/60seconds_new-main
git revert HEAD~1  # Revert to previous version
git push origin main

# New build with previous version
./deploy-production.sh both
```

---

## ✅ Success Criteria

**Deployment is COMPLETE when:**

- [x] iOS app v88.0.0 on App Store (after review)
- [x] Android app v88.0.0 on Google Play (staged rollout starts)
- [x] Single purchase test passes on Android ✅
- [x] Cart purchase test passes on iOS ✅
- [x] Webhook processes payments without errors ✅
- [x] Tickets issued within 5 seconds ✅
- [x] Product stock decremented correctly ✅
- [x] Organizer wallet credited with correct amount (96%) ✅
- [x] Zero crash reports in first 2 hours ✅

---

## 📊 Deployment Timeline

| Task | Time | Status |
|------|------|--------|
| Pre-deployment checks | 5 min | ⏳ TODO |
| Commit & push | 2 min | ⏳ TODO |
| Build iOS | 15 min | ⏳ TODO |
| Build Android | 15 min | ⏳ TODO |
| Submit to stores | 5 min | ⏳ TODO |
| iOS App Store review | 24-48 hrs | ⏳ WAITING |
| Android staging rollout | 1-2 hrs | ⏳ WAITING |
| Testing (10% rollout) | 30 min | ⏳ TODO |
| Full production rollout | Variable | ⏳ PENDING |

**Total: ~24-72 hours to full production**

---

## 📞 Support & Troubleshooting

**Build Issues:**
- https://docs.expo.dev/build/troubleshooting/

**EAS Submit Issues:**
- https://docs.expo.dev/submit/troubleshooting/

**App Store Connect Issues:**
- https://developer.apple.com/help/app-store-connect/

**Google Play Console Issues:**
- https://support.google.com/googleplay/android-developer/

**Supabase Edge Functions Issues:**
- Dashboard: https://supabase.com/dashboard/project/rvvujgbaswecqohixgog/functions
- Logs: View in Edge Function details
- Redeploy: `npx supabase functions deploy paystack-webhook-settlement`

---

**Ready to deploy? Start with:**
```bash
./deploy-production.sh both
```

**Questions? See:**
- [SUPABASE_PRODUCTION_DEPLOYMENT.md](SUPABASE_PRODUCTION_DEPLOYMENT.md)
- [PRODUCTION_DEPLOYMENT_FINAL.md](PRODUCTION_DEPLOYMENT_FINAL.md)
