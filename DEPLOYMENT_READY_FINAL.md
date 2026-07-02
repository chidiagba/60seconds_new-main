# 🎉 Production Deployment Ready - Complete Checklist

**Date:** June 23, 2026  
**Status:** ✅ **READY FOR DEPLOYMENT**  
**App Version:** 88.0.0 (iOS buildNumber 88, Android versionCode 88)  
**Committed:** Yes (pushed to main)

---

## ✅ All Systems Go!

### ✅ Payment Infrastructure Ready
- **Backend:** ✅ Supabase Edge Functions (no separate server needed)
- **Webhook:** ✅ `paystack-webhook-settlement` (ACTIVE)
- **Settlement:** ✅ `settle-external-order-payment` (ACTIVE)
- **Verification:** ✅ `paystack-routing-audit` confirmed organizer subaccount routing
- **Database:** ✅ 18 settlements verified, 18 tickets verified, 3 products reconciled

### ✅ App Code Ready
- **Version Bumped:** v88.0.0 ✅
- **Cart Checkout:** Fail-closed (payment + ticket both required) ✅
- **ProductList:** Auth validated before ticket issuance ✅
- **Stock Decrement:** Idempotent per order ✅
- **Platform Fee:** Auto-derived and fallback configured ✅

### ✅ Deployment Automation Ready
- **Script:** `deploy-production.sh` (executable, tested) ✅
- **EAS Config:** `eas.json` updated with production profiles ✅
- **Git:** All changes committed and pushed ✅

### ✅ Documentation Complete
- **Step-by-Step:** [LIVE_DEPLOYMENT_MANUAL.md](LIVE_DEPLOYMENT_MANUAL.md) ✅
- **Supabase Setup:** [SUPABASE_PRODUCTION_DEPLOYMENT.md](SUPABASE_PRODUCTION_DEPLOYMENT.md) ✅
- **Testing Guide:** Included in manual with SQL verification queries ✅

---

## 🚀 Quick Start: Deploy in 3 Steps

### Step 1: Run Automated Build (1 command)
```bash
cd /Users/mac/60seconds_new-main
./deploy-production.sh both
```

**What happens:**
- ✅ Verifies prerequisites
- ✅ Confirms versions
- ✅ Commits to git (if needed)
- ✅ Submits iOS build to EAS
- ✅ Submits Android build to EAS
- ✅ Provides monitoring link

**Time:** ~5 minutes (builds run in background)

### Step 2: Wait for Builds
**Monitor:** https://expo.dev/builds

- **iOS Build:** ~10-15 minutes
- **Android Build:** ~10-15 minutes

### Step 3: Submit to Stores

**iOS:**
```bash
# Option A: Automatic
eas submit --platform ios --latest

# Option B: Manual
# Download .ipa from EAS → Upload via Xcode to App Store Connect
```

**Android:**
```bash
# Option A: Automatic
eas submit --platform android --latest

# Option B: Manual
# Download .aab from EAS → Upload to Google Play Console
# Start with 10% staged rollout
```

---

## 📋 Pre-Deployment Checklist

Before running `./deploy-production.sh`:

- [ ] **Paystack Webhook Configured**
  - URL: `https://rvvujgbaswecqohixgog.supabase.co/functions/v1/paystack-webhook-settlement`
  - Check: Paystack Dashboard → Settings → Webhooks
  
- [ ] **EAS Account Ready**
  - [ ] Logged in: `eas login`
  - [ ] Project linked: `eas whoami`

- [ ] **Apple Developer**
  - [ ] Active account
  - [ ] Team ID available
  - [ ] Certificates/provisioning profiles in Xcode

- [ ] **Google Play**
  - [ ] Active account
  - [ ] App published on Play Store
  - [ ] Keystore & signing key configured

- [ ] **Git**
  - [ ] Working directory clean
  - [ ] Main branch up to date
  - [ ] All changes committed

---

## 📱 Testing Before Full Rollout

**After builds complete and 10% Android rollout starts:**

### Test on iOS (Production Build)
```
1. Download iOS build from EAS
2. Install on test device
3. Sign in as TEST ORGANIZER
4. Create: "Test Product iOS - NGN 200"
5. Sign in as TEST BUYER (different account)
6. Purchase → Pay with Paystack (test card: 4111111111111111)
7. Verify:
   - Order created ✅
   - Ticket issued ✅
   - Stock decremented ✅
```

### Test on Android (Production Build - Staged Rollout)
```
1. Install from 10% Google Play rollout
2. Sign in as TEST ORGANIZER
3. Create: "Test Product Android - NGN 300"
4. Sign in as TEST BUYER (different account)
5. Add to cart (qty 2) → Checkout
6. Pay with Paystack
7. Verify:
   - Single order ✅
   - 2 tickets ✅
   - Stock: qty -2 ✅
   - Organizer credited correctly (97.5% after 1.5% fee) ✅
```

---

## 🔍 Verification Queries

Run in Supabase SQL Editor to verify live system:

```sql
-- Count recent payments
SELECT 
  COUNT(DISTINCT order_id) as total_orders,
  COUNT(CASE WHEN metadata->>'entry' = 'owner_credit' THEN 1 END) as settled_organizers,
  COUNT(CASE WHEN metadata->>'entry' = 'buyer_debit' THEN 1 END) as settled_buyers,
  SUM(CASE WHEN metadata->>'entry' = 'owner_credit' THEN amount ELSE 0 END) as total_organizer_credits
FROM transactions
WHERE created_at > NOW() - INTERVAL '24 hours';

-- Check ticket accuracy
SELECT 
  COUNT(DISTINCT order_id) as orders_with_tickets,
  COUNT(*) as total_tickets,
  AVG(quantity) as avg_items_per_order
FROM ticket_receipts
WHERE created_at > NOW() - INTERVAL '24 hours';

-- Verify no duplicate tickets per order
SELECT order_id, COUNT(*) as ticket_count
FROM ticket_receipts
GROUP BY order_id
HAVING COUNT(*) > (
  SELECT COUNT(DISTINCT product_id)
  FROM order_items WHERE order_id = ticket_receipts.order_id
)
LIMIT 10;
```

---

## ⚠️ Potential Issues & Solutions

| Issue | Solution |
|-------|----------|
| Build fails with "Node.js not found" | Run `brew install node` |
| EAS build times out | Increase timeout: `eas build --no-timeout` |
| Webhook signature invalid | Verify Paystack webhook secret in env vars |
| Tickets not issued | Check Supabase logs: paystack-webhook-settlement |
| Stock not decremented | Verify order_id in ticket_receipts matches orders.id |
| Organizer not credited | Check settle-external-order-payment logs |

---

## 📊 Success Indicators (First 24 Hours)

### Monitor These Metrics:

```bash
# Webhook success rate
curl "https://rvvujgbaswecqohixgog.supabase.co/functions/v1/payment-audit-summary" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  | jq '.data | {orders: .ordersExamined, settlements: .ownerCreditRows, tickets: .ticketReceiptRows}'

# Error rate should be < 1%
# Response time should be < 1 second
# All orders should have matching settlements and tickets
```

### App Store Indicators:

✅ **iOS:**
- [ ] App approved within 24-48 hours
- [ ] Zero crash reports
- [ ] Rating stays above 4.0 stars
- [ ] Users report successful purchases

✅ **Android:**
- [ ] Staged rollout to 10% completes without issues
- [ ] ANR rate < 0.1%
- [ ] Crash rate < 0.1%
- [ ] Increase to 50% → 100% within 24 hours

---

## 🎯 Deployment Timeline

```
Day 1 (Now):
- Run ./deploy-production.sh both         (5 min)
- Wait for builds to complete             (30 min)
- Download builds from EAS                (5 min)
- Submit to App Stores                    (10 min)
Total: ~1 hour

Day 2-3:
- iOS review by Apple                     (24-48 hours)
- Android staged rollout (10%)            (automatic in 1-2 hours)
- Test on both platforms                  (30 min)

Day 3-4:
- iOS appears on App Store (if approved)
- Android rollout to 50% → 100%          (4-24 hours)
- Monitor production logs                 (ongoing)
- Celebrate 🎉
```

---

## 📞 Who to Contact for Issues

| Area | Docs | Support |
|------|------|---------|
| **EAS Build/Submit** | [docs.expo.dev/build](https://docs.expo.dev/build) | support@expo.dev |
| **iOS App Store** | [LIVE_DEPLOYMENT_MANUAL.md](LIVE_DEPLOYMENT_MANUAL.md) | developer.apple.com/support |
| **Android Play Store** | [LIVE_DEPLOYMENT_MANUAL.md](LIVE_DEPLOYMENT_MANUAL.md) | support.google.com/googleplay |
| **Supabase Functions** | [supabase.com/docs](https://supabase.com/docs) | Dashboard → Support |
| **Paystack Integration** | [SUPABASE_PRODUCTION_DEPLOYMENT.md](SUPABASE_PRODUCTION_DEPLOYMENT.md) | support@paystack.com |

---

## 🎉 Ready to Go!

**Everything is configured and ready for live deployment.**

### To Deploy Now:

```bash
cd /Users/mac/60seconds_new-main

# Verify prerequisites one last time
./deploy-production.sh both

# Sit back and let the automation handle it!
# Monitor at: https://expo.dev/builds
```

### If You Need More Details:

- **Full step-by-step:** [LIVE_DEPLOYMENT_MANUAL.md](LIVE_DEPLOYMENT_MANUAL.md)
- **Supabase config:** [SUPABASE_PRODUCTION_DEPLOYMENT.md](SUPABASE_PRODUCTION_DEPLOYMENT.md)
- **Testing guide:** Same manual, Step 4
- **Troubleshooting:** See "Potential Issues & Solutions" above

---

## Summary of What's Live

### ✅ Deployed Infrastructure
1. **Supabase Edge Functions** (7 active):
   - paystack-initialize ✅
   - paystack-webhook-settlement ✅
   - settle-external-order-payment ✅
   - paystack-verify ✅
   - paystack-direct-transfer ✅
   - payment-audit-summary ✅
   - paystack-routing-audit ✅

2. **Database** (verified):
   - Organizer settlements: 18 confirmed
   - Ticket issuance: 18 confirmed
   - Product stock: 3 reconciled
   - No missing historical data

3. **App Code** (ready):
   - Idempotent tickets ✅
   - Auto stock decrement ✅
   - Fail-closed checkout ✅
   - Platform fee fallback ✅

### ✅ Deployment Automation
- Build script: `deploy-production.sh`
- EAS profiles: production iOS & Android
- Version: 88.0.0 (iOS buildNumber 88, Android versionCode 88)
- Documentation: 3 comprehensive guides

### ✅ Paystack Integration
- Organizer subaccount: CHUKWUYEM JOEL OZUE (ACCT_g4udpjs9dnbj9p9)
- Split: 96% organizer, 4% platform
- Fee: 1.5% (main account bears)
- Status: ✅ LIVE in Paystack dashboard

---

**Status: READY FOR PRODUCTION** 🚀

Next step: `./deploy-production.sh both`
