# Production Deployment Guide - Supabase Only

**Date:** 2026-06-23  
**Status:** Ready for iOS & Android App Store Deployment  
**Architecture:** Supabase Edge Functions Only (No Separate Backend)

---

## 🎯 Current Status

### ✅ Edge Functions Deployed (Supabase)
All payment processing functions are **ACTIVE** and live:

| Function | Purpose | Version | Status |
|----------|---------|---------|--------|
| `paystack-initialize` | Initialize Paystack checkout | 6 | ✅ ACTIVE |
| `paystack-webhook-settlement` | Webhook handler (charge.success) | 7 | ✅ ACTIVE |
| `settle-external-order-payment` | Generic order settlement | 9 | ✅ ACTIVE |
| `paystack-verify` | Verify payment status | 5 | ✅ ACTIVE |
| `paystack-direct-transfer` | Organizer payouts | 13 | ✅ ACTIVE |
| `paystack-routing-audit` | Routing verification | 3 | ✅ ACTIVE |

### ✅ Database Ready
- Settlements verified: 18 owner_credit transactions ✅
- Tickets verified: 18 ticket_receipts ✅
- Stock reconciled: 3 products ✅
- Organizer routing: CHUKWUYEM JOEL OZUE (ACCT_g4udpjs9dnbj9p9) ✅

### ✅ App Code Ready
- [lib/database.ts](lib/database.ts): Idempotent ticket + stock decrement ✅
- [app/cart.tsx](app/cart.tsx): Fail-closed checkout ✅
- [components/ProductsList.tsx](components/ProductsList.tsx): Auth validation ✅

---

## 🚀 Step 1: Configure Paystack Webhook (1 minute)

The Paystack webhook must point to the Supabase edge function:

**Paystack Dashboard Configuration:**

1. **Login** to https://dashboard.paystack.com
2. Navigate: **Settings** → **API Keys & Webhooks** → **Webhooks**
3. **Add Webhook URL:**
   ```
   https://rvvujgbaswecqohixgog.supabase.co/functions/v1/paystack-webhook-settlement
   ```
4. **Select Events:**
   - ✅ `charge.success`
   - ✅ `charge.failed`
5. **Copy Webhook Secret** and save to environment

**Verify Webhook is Active:**
```bash
curl -X GET "https://dashboard.paystack.com/api/webhook" \
  -H "Authorization: Bearer ${PAYSTACK_SECRET_KEY}" \
  | jq '.data[] | select(.url | contains("paystack-webhook-settlement"))'
```

---

## 🔄 Step 2: Update App Version & Build

### Update Version Numbers

**iOS (Increment Version):**
```bash
# app.json
# Change:
# "version": "87.0.0"  →  "version": "88.0.0"
# "buildNumber": "87"  →  "buildNumber": "88"
```

**Android (Increment Version Code):**
```bash
# app.json
# Change:
# "versionCode": 87  →  "versionCode": 88
# "versionName": "87.0.0"  →  "versionName": "88.0.0"
```

**Commit Version Bump:**
```bash
cd /Users/mac/60seconds_new-main
git add app.json
git commit -m "chore: bump app version to 88.0.0 for Supabase payment production deployment"
git push origin main
```

---

## 📱 Step 3: Build for iOS App Store

**Prerequisites:**
- Xcode 14+ installed
- Apple Developer account
- Signing certificates configured

**Build Command:**
```bash
cd /Users/mac/60seconds_new-main

# Login to EAS
eas login

# Build for iOS Production
eas build --platform ios \
  --profile production \
  --message "Production: Supabase payment settlement v88.0.0"
```

**Build Output:**
- Wait for build to complete (~10-15 minutes)
- Download `.ipa` file when ready
- Or let EAS submit directly to TestFlight/App Store

**iOS Build Verification:**
- Open `app.json` - version should be 88.0.0 ✅
- Check build logs for environment variables ✅
- Supabase URL should be: `https://rvvujgbaswecqohixgog.supabase.co`

---

## 🤖 Step 4: Build for Android Play Store

**Prerequisites:**
- Android SDK installed
- Play Store account
- Signing keystore configured

**Build Command:**
```bash
cd /Users/mac/60seconds_new-main

eas build --platform android \
  --profile production \
  --message "Production: Supabase payment settlement v88.0.0"
```

**Build Output:**
- Wait for build to complete (~10-15 minutes)
- Download `.aab` file (Android App Bundle) when ready
- Or let EAS submit directly to Google Play

**Android Build Verification:**
- Version code: 88 ✅
- Version name: 88.0.0 ✅
- Package name: `app.sixtyseconds.nightlife` ✅

---

## 📦 Step 5: Deploy to App Stores

### iOS App Store Submission

**Option A: Manual via TestFlight → App Store Connect**

1. Download `.ipa` from EAS build
2. Open Xcode Organizer
3. Upload to App Store
4. Fill submission info:
   - Release notes: "Supabase payment settlement production deployment"
   - Version: 88.0.0
5. Submit for review (usually 24-48 hours)

**Option B: Let EAS Submit**
```bash
eas submit --platform ios \
  --latest \
  --message "iOS 88.0.0 Production Submission"
```

### Android Play Store Submission

**Option A: Manual via Google Play Console**

1. Download `.aab` from EAS build
2. Go to Google Play Console
3. Select app → Release → New Release
4. Upload `.aab` file
5. Fill release notes:
   - "Production: Supabase payment settlement with idempotent tickets and auto stock decrement"
   - Version: 88.0.0
6. Rollout: Start with **10%** then **50%** then **100%** over 24-48 hours

**Option B: Let EAS Submit**
```bash
eas submit --platform android \
  --latest \
  --message "Android 88.0.0 Production Submission"
```

---

## ✅ Step 6: Post-Deployment Verification

### Live Testing Checklist

**Before Full Rollout (on 10% staging rollout):**

1. **ProductList Single Purchase:**
   ```bash
   # On Android device
   - Open app (v88.0.0)
   - Create test product: "Test Single - NGN 100"
   - As buyer: click "Buy Now" → "Pay with Paystack"
   - Complete with test card: 4111111111111111 (PIN: 123456)
   - Verify: Order created ✅, Ticket issued ✅, Stock decremented ✅
   ```

2. **Cart Multi-Item Purchase:**
   ```bash
   # On iOS device
   - Open app (v88.0.0)
   - Add 2 items to cart → Checkout
   - Pay with Paystack
   - Verify: All tickets issued ✅, Stock updated ✅
   ```

3. **Webhook Verification:**
   ```bash
   # Check Supabase function logs
   curl "https://rvvujgbaswecqohixgog.supabase.co/functions/v1/paystack-webhook-settlement?logs=true" \
     -H "apikey: ${SUPABASE_ANON_KEY}" \
     -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}"
   
   # Or via Supabase Dashboard:
   # https://supabase.com/dashboard/project/rvvujgbaswecqohixgog → Functions → paystack-webhook-settlement → Logs
   ```

4. **Database Verification:**
   ```sql
   -- Check recent settlement
   SELECT order_id, amount, entry, created_at
   FROM transactions
   WHERE metadata->>'entry' IN ('owner_credit', 'buyer_debit')
   ORDER BY created_at DESC
   LIMIT 2;
   
   -- Check recent ticket
   SELECT order_id, product_id, quantity, status
   FROM ticket_receipts
   ORDER BY created_at DESC
   LIMIT 1;
   ```

### Monitoring (First 24 Hours)

1. **Check Supabase Logs:**
   - Dashboard → Functions → paystack-webhook-settlement → Logs
   - Look for error rate (should be < 1%)
   - Monitor for timeout errors

2. **Check App Crash Reports:**
   - iOS: App Store Connect → TestFlight → Crash Logs
   - Android: Google Play Console → Vitals → Crashes

3. **Monitor Database Growth:**
   ```sql
   SELECT 
     DATE(created_at) as date,
     COUNT(*) as order_count,
     COUNT(CASE WHEN metadata->>'entry' = 'owner_credit' THEN 1 END) as settlements
   FROM transactions
   WHERE created_at > NOW() - INTERVAL '24 hours'
   GROUP BY DATE(created_at);
   ```

---

## 🔐 Environment Variables (Reference)

All these should be set in Supabase environment:

```bash
# Supabase
EXPO_PUBLIC_SUPABASE_URL=https://rvvujgbaswecqohixgog.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>

# Paystack
PAYSTACK_WEBHOOK_SECRET=<from_paystack_dashboard>
PAYSTACK_SECRET_KEY=<from_paystack_dashboard>

# Worldline (Twint)
WORLDLINE_MERCHANT_ID=<your_merchant_id>
WORLDLINE_API_KEY=<your_api_key>

# Admin tokens for backfill functions
BACKFILL_ADMIN_TOKEN=backfill-run-2026-06-23-ops
```

---

## 📊 Deployment Timeline

| Step | Time | Status |
|------|------|--------|
| 1. Configure Paystack webhook | 1 min | ⏳ TODO |
| 2. Update app versions | 2 min | ⏳ TODO |
| 3. Build iOS | 15 min | ⏳ TODO |
| 4. Build Android | 15 min | ⏳ TODO |
| 5. Submit to stores | 5 min | ⏳ TODO |
| 6. App Store review (iOS) | 24-48 hrs | ⏳ WAITING |
| 7. Google Play staging (Android) | 1-2 hrs | ⏳ WAITING |
| 8. Live testing | 30 min | ⏳ TODO |
| 9. Full rollout | Variable | ⏳ PENDING |

**Total Time to Production:** ~24-72 hours

---

## ⚠️ Rollback Plan

If issues occur after deployment:

1. **Pause Android rollout:**
   ```bash
   # Google Play Console → Release Management
   # Set rollout % to 0% (pauses distribution)
   ```

2. **Pause iOS rollout:**
   ```bash
   # App Store Connect → TestFlight or App Store
   # Remove from testing/sale
   ```

3. **Check Edge Functions:**
   ```bash
   # View function errors in Supabase dashboard
   # If needed, deploy previous working version:
   npx supabase functions deploy paystack-webhook-settlement --project-ref rvvujgbaswecqohixgog
   ```

4. **Database Rollback:**
   - Supabase Dashboard → Backups
   - Restore from 24-hour checkpoint if needed

---

## 🎉 Success Criteria

✅ **Deployment is successful when:**
- iOS app v88.0.0 available on App Store
- Android app v88.0.0 available on Google Play
- Test purchase on both platforms completes successfully
- Ticket issued within 5 seconds of payment
- Organizer wallet credited correctly
- Zero webhook failures in first 24 hours
- Users report successful purchases in both stores

---

## 📞 Support

**For questions:**
- Payment flow: See [PAYSTACK_WEBHOOK_DEPLOY_AND_BACKFILL.md](PAYSTACK_WEBHOOK_DEPLOY_AND_BACKFILL.md)
- Database schema: See [PRODUCTION_SCHEMA_FINAL.sql](PRODUCTION_SCHEMA_FINAL.sql)
- Edge functions: Supabase Dashboard → Functions → Logs
- Store submissions: Apple Dev or Google Play support

**Contact:** [Your support email]

---

**Deployment Started:** [To be filled]  
**Deployed By:** [Your name]  
**Build Versions:** iOS 88.0.0 | Android 88.0.0 (versionCode 88)
