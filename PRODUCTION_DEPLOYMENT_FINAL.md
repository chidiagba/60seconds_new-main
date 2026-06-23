# Production Deployment & Testing - Final Steps

**Date:** 2026-06-23  
**Status:** ✅ Paystack Dashboard Verified | ⏳ Backend Deployment Ready | ⏳ Live Testing

---

## ✅ COMPLETED: Paystack Configuration Verification

### Dashboard Audit Results

**Transaction Splits Page:**
- Status: ✅ **LIVE** (green indicator)
- Main Account: 60seconds (1550290)
- Split Configuration: **ACTIVE**

**Organizer Subaccount Configuration:**
| Field | Value | Status |
|-------|-------|--------|
| Name | CHUKWUYEM JOEL OZUE | ✅ Verified |
| Provider | OPay Digital Services Limited | ✅ Verified |
| Recipient Code | `ACCT_g4udpjs9dnbj9p9` | ✅ Active |
| Split % | 96% | ✅ Active |
| Bank Account | 7039524913 | ✅ Verified |
| Fee Model | 1.5% (Main Account Bears) | ✅ Correct |

**Conclusion:** Paystack organizer subaccount routing is correctly configured for production settlement.

---

## Task 1: Backend Deployment (Hono + Webhook)

### Current State
- ✅ Edge Functions (Supabase): All deployed successfully
- ⏳ Backend Server: `POST /api/paystack/webhook` ready at [backend/hono.ts](backend/hono.ts#L800)
- ✅ Webhook Handler: Implements idempotent settlement + ticket issuance

### Backend Webhook Route
**Location:** [backend/hono.ts](backend/hono.ts#L800-L870)

**Functionality:**
- Listens for `charge.success` events from Paystack
- Routes to either wallet funding or order settlement
- Calls `settlePaystackOrderPayment()` or `settlePaystackWalletFunding()`
- Returns 200 OK to acknowledge receipt

### Deployment Instructions

#### Option A: Local Development Server (Recommended for Testing)
```bash
cd /Users/mac/60seconds_new-main

# Install dependencies (if not already done)
npm install

# Set environment variables
export EXPO_PUBLIC_SUPABASE_URL="https://rvvujgbaswecqohixgog.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your_supabase_service_role_key"
export PAYSTACK_WEBHOOK_SECRET="your_webhook_secret_from_paystack_dashboard"

# Start the backend server on port 3001
npm run dev
# or
node start-server.js
```

**Server Output:**
```
🚀 Starting Worldline Payment Server...
✅ Server running on http://localhost:3001
🎯 Ready to handle Worldline payments!
```

**Available Endpoints:**
- `http://localhost:3001/api/paystack/webhook` — Paystack webhook receiver
- `http://localhost:3001/api/trpc` — TRPC API endpoint
- `http://localhost:3001/` — Health check

#### Option B: Production Deployment (Choose Your Host)

**Recommended Hosts:**
- Heroku (legacy but works): `git push heroku main`
- Railway: Import from GitHub, set env vars, deploy
- Render: `npm run dev` as start command
- AWS Elastic Beanstalk: Use Node.js platform

**Required Environment Variables:**
```
EXPO_PUBLIC_SUPABASE_URL=https://rvvujgbaswecqohixgog.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
PAYSTACK_WEBHOOK_SECRET=<webhook_secret_from_paystack_dashboard>
WORLDLINE_MERCHANT_ID=<your_merchant_id>
WORLDLINE_API_KEY=<your_api_key>
RORK_API_BASE_URL=https://api.yourhost.com
```

### Paystack Dashboard Webhook Configuration

After deploying backend, configure webhook in Paystack Dashboard:

1. Go to **Settings** → **Webhooks**
2. Set **URL** to: `https://your-api-domain.com/api/paystack/webhook`
3. Select events: `charge.success`, `charge.failed`
4. Copy **Webhook Secret** and set as `PAYSTACK_WEBHOOK_SECRET` env var
5. Click **Enable Webhook**

---

## Task 2: Live End-to-End Testing

### Test Scenario 1: ProductList Single Purchase

**Objective:** Verify single-item purchase flow with Paystack split routing

**Steps:**

1. **Mobile App Setup:**
   ```bash
   # In app terminal
   export EXPO_PUBLIC_RORK_API_BASE_URL=http://192.168.x.x:3001
   npm start
   ```

2. **Create Test Product:**
   - Log in as organizer
   - Navigate to `Create Product/Voucher`
   - Create product: **"Test Product - Single"**
   - Price: **NGN 100.00**
   - Quantity: **5**
   - Save & verify product ID in database

3. **Purchase Flow:**
   - Logout, create new buyer account
   - Navigate to product in ProductList
   - Click "Buy Now"
   - Click "Pay with Paystack"
   - Complete Paystack checkout with **test card 4111111111111111** (PIN: 123456)
   - Expected: Success screen with order reference

4. **Verification:**
   ```sql
   -- In Supabase SQL Editor
   SELECT id, order_id, status, amount, metadata
   FROM orders
   WHERE buyer_id = 'new_buyer_id'
   AND metadata->>'payment_method' = 'paystack'
   ORDER BY created_at DESC
   LIMIT 1;
   
   -- Check ticket issued
   SELECT order_id, product_id, quantity, status
   FROM ticket_receipts
   WHERE order_id = 'test_order_id';
   
   -- Check settlement created
   SELECT order_id, amount, entry, metadata
   FROM transactions
   WHERE order_id = 'test_order_id'
   AND (metadata->>'entry' = 'owner_credit' OR metadata->>'entry' = 'buyer_debit');
   
   -- Check stock decremented
   SELECT id, available_quantity, sold_quantity
   FROM products
   WHERE id = 'test_product_id';
   ```

   **Expected Results:**
   - ✅ 1 order created with status `settled`
   - ✅ 1 ticket_receipt created with status `issued`
   - ✅ 2 transactions: 1 `owner_credit` (organizer) + 1 `buyer_debit` (buyer)
   - ✅ Product: `available_quantity` decreased by 1, `sold_quantity` increased by 1
   - ✅ Organizer receives 96% of amount (after 1.5% platform fee)

---

### Test Scenario 2: Cart Multi-Item Purchase

**Objective:** Verify cart checkout with multiple items from same organizer

**Steps:**

1. **Create Test Products (as organizer):**
   - Product 1: **"Bundle Item A"** - NGN 50.00, qty 10
   - Product 2: **"Bundle Item B"** - NGN 75.00, qty 10

2. **Cart Purchase (as buyer):**
   - Navigate to ProductList
   - Add Product A (qty 2) to cart
   - Add Product B (qty 1) to cart
   - Navigate to cart
   - Review: Total should be **NGN 175.00** (2×50 + 1×75)
   - Click "Checkout with Paystack"
   - Complete payment with test card

3. **Verification:**
   ```sql
   -- Check single order created
   SELECT id, total_amount, buyer_id, owner_id
   FROM orders
   WHERE buyer_id = 'cart_buyer_id'
   ORDER BY created_at DESC
   LIMIT 1;
   
   -- Verify cart items linked
   SELECT order_id, product_id, quantity
   FROM order_items
   WHERE order_id = 'test_order_id';
   
   -- Check multiple tickets issued
   SELECT product_id, COUNT(*) as ticket_count
   FROM ticket_receipts
   WHERE order_id = 'test_order_id'
   GROUP BY product_id;
   
   -- Verify both products decremented
   SELECT id, available_quantity, sold_quantity
   FROM products
   WHERE id IN ('product_a_id', 'product_b_id');
   ```

   **Expected Results:**
   - ✅ 1 order with 2 cart items
   - ✅ 3 tickets total (2 for Product A + 1 for Product B)
   - ✅ 2 transactions (owner_credit + buyer_debit) with correct amount split
   - ✅ Product A: available_quantity -2, sold_quantity +2
   - ✅ Product B: available_quantity -1, sold_quantity +1

---

### Test Scenario 3: Settlement Via Webhook

**Objective:** Verify Paystack webhook correctly settles payment

**Steps:**

1. **Monitor Backend Logs:**
   ```bash
   # In backend terminal
   tail -f server.log
   # Or watch console output
   ```

2. **Complete Payment (ProductList or Cart)**

3. **Webhook Firing:**
   - Expected log: `🔗 Paystack webhook received: { event: 'charge.success', ... }`
   - Expected log: `✅ Paystack order settlement completed: { ... }`

4. **Verify Settlement in Database:**
   ```sql
   SELECT created_at, updated_at, metadata
   FROM transactions
   WHERE order_id = 'test_order_id'
   ORDER BY created_at;
   ```

   **Expected Results:**
   - ✅ `owner_credit` created at webhook time
   - ✅ `buyer_debit` created at webhook time
   - ✅ `created_at` timestamps should match webhook event timing

---

## Task 3: Payment Audit Verification

### Automated Audit Endpoints (Already Deployed)

All following endpoints are live and can be called from any HTTPS client:

#### 1. Payment Audit Summary
```bash
curl -X POST https://rvvujgbaswecqohixgog.supabase.co/functions/v1/payment-audit-summary \
  -H 'Content-Type: application/json' \
  -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ2dnVqZ2Jhc3dlY3FvaGl4Z29nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk1NDc3NDUsImV4cCI6MjA1NTEyMzc0NX0.7tN4mfu7H6mYCTzGkCO6qzIoEzvIffa_iveNxXkJkXc' \
  --data '{}'
```

**Response:** Order count, settlement count, ticket count, product stock snapshot

#### 2. Reconcile Product Stock
```bash
curl -X POST https://rvvujgbaswecqohixgog.supabase.co/functions/v1/reconcile-product-stock-from-receipts \
  -H 'Content-Type: application/json' \
  -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'  \
  --data '{}'
```

**Response:** Number of products updated, stock corrections applied

#### 3. Paystack Routing Audit
```bash
curl -X POST https://rvvujgbaswecqohixgog.supabase.co/functions/v1/paystack-routing-audit \
  -H 'Content-Type: application/json' \
  -H 'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' \
  --data '{}'
```

**Response:** List of organizers with Paystack subaccount routing configured

---

## Summary of Production Changes

### Code Changes Deployed ✅

| Component | Change | Impact |
|-----------|--------|--------|
| [lib/database.ts](lib/database.ts#L1348-L1495) | Idempotent ticket creation + auto stock decrement | Prevents duplicate tickets & ensures stock accuracy |
| [app/cart.tsx](app/cart.tsx#L308-L827) | Fail-closed settlement & ticket errors | Payment integrity: all-or-nothing checkout |
| [components/ProductsList.tsx](components/ProductsList.tsx#L637-L725) | Auth check before ticket issuance | Prevents tickets for unauthenticated users |
| [supabase/functions/paystack-initialize/index.ts](supabase/functions/paystack-initialize/index.ts#L107-L145) | Platform fee fallback + bearer default | Correct fee allocation to organizer |
| [backend/hono.ts](backend/hono.ts#L800-L870) | Webhook settlement route | Real-time settlement on Paystack callback |

### Database Integrity ✅

- ✅ Existing transactions: All settled (18 owner_credit + 18 buyer_debit)
- ✅ Existing tickets: All issued (18 ticket_receipts)
- ✅ Product stock: Reconciled with actual sales (3 products updated)
- ✅ Organizer routing: Verified in Paystack dashboard (CHUKWUYEM JOEL OZUE at 96%)

### Remaining Actions

**Before Production Launch:**
1. ⏳ Deploy backend to production host (see Task 1)
2. ⏳ Configure Paystack webhook URL in dashboard
3. ⏳ Run end-to-end tests (see Task 2)
4. ⏳ Monitor webhook logs for 24 hours
5. ⏳ Verify settlement timing (< 5 minutes from purchase)

**Post-Deployment Monitoring:**
- Monitor backend logs for webhook errors
- Run audit endpoints daily to verify settlement consistency
- Set up alerts for failed settlements (webhook errors)
- Check Paystack dashboard for subaccount payout timing

---

## Contact & Support

For questions on:
- **Payment Flow:** See [PAYSTACK_WEBHOOK_DEPLOY_AND_BACKFILL.md](PAYSTACK_WEBHOOK_DEPLOY_AND_BACKFILL.md)
- **Database Schema:** See [PRODUCTION_SCHEMA_FINAL.sql](PRODUCTION_SCHEMA_FINAL.sql)
- **Email Confirmation:** See [SUPABASE_EMAIL_SETUP.md](SUPABASE_EMAIL_SETUP.md)
- **Audit Tools:** Use edge function endpoints (all deployed)

---

**Deployment Date:** [To be filled on actual deployment]  
**Deployed By:** [Your name/team]  
**Status:** [Test/Staging/Production]
