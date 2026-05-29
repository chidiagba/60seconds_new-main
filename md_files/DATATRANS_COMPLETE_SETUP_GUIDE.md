# 💳 Complete Datatrans Payment Setup Guide

## 📋 **Overview**

This guide will walk you through **ALL** the steps needed to implement Datatrans payment in your app. The code is already implemented - you just need to deploy and configure it.

---

## 🎯 **Choose Your Deployment Method**

**You have 2 options to deploy the function:**

### **Option 1: Deploy via Supabase Dashboard (No CLI Required)** ⭐ **RECOMMENDED IF YOU DON'T WANT CLI**
- ✅ No command line needed
- ✅ All done through web browser
- 📖 **See**: `DATATRANS_DEPLOY_VIA_DASHBOARD.md` for step-by-step instructions

### **Option 2: Deploy via CLI (Command Line)**
- ✅ Faster for developers
- ✅ Can automate with scripts
- 📖 **Continue reading this guide** for CLI instructions

---

## 🎯 **What You Need to Do**

1. ✅ **Deploy Supabase Edge Function** (the payment processing code)
2. ✅ **Get Datatrans Credentials** (from Datatrans dashboard)
3. ✅ **Configure Secrets in Supabase** (so the function can access Datatrans)
4. ✅ **Test the Payment** (verify everything works)

---

## 📦 **Step 1: Install Supabase CLI**

The Supabase CLI is needed to deploy edge functions.

### **Installation:**

```bash
# Install globally using npm
npm install -g supabase

# OR using Homebrew (Mac)
brew install supabase/tap/supabase

# Verify installation
supabase --version
```

**Expected Output**: `supabase version X.X.X`

---

## 🔐 **Step 2: Login to Supabase**

Link your local machine to your Supabase project.

```bash
# Login to Supabase (opens browser for authentication)
supabase login

# Link to your project (replace with your project ref if different)
supabase link --project-ref rvvujgbaswecqohixgog
```

**Note**: Your project reference is `rvvujgbaswecqohixgog` (found in your Supabase dashboard URL)

---

## 🚀 **Step 3: Deploy the Datatrans Payment Function**

This deploys the payment processing code to Supabase.

```bash
# Navigate to your project root
cd /Users/yashvekariya/Desktop/rork-60seconds

# Deploy the datatrans-payment function
supabase functions deploy datatrans-payment
```

**Expected Output**:
```
Deploying function datatrans-payment...
Function datatrans-payment deployed successfully!
```

**If you get an error**, make sure:
- ✅ You're logged in: `supabase login`
- ✅ Project is linked: `supabase link --project-ref rvvujgbaswecqohixgog`
- ✅ You're in the project root directory

---

## 🔑 **Step 4: Get Datatrans Credentials**

You need to get your Datatrans API credentials from the Datatrans dashboard.

### **4.1: Access Datatrans Dashboard**

1. **For Sandbox (Testing)**:
   - Go to: https://admin.sandbox.datatrans.com/Login.jsp
   - Sign up or login with your test account

2. **For Production**:
   - Go to: https://admin.datatrans.com/Login.jsp
   - Login with your production account

### **4.2: Get Your Credentials**

In the Datatrans dashboard, find:

1. **Merchant ID** (e.g., `1110020919`)
   - Usually found in: Settings → Merchant Information
   - Or: API Settings → Credentials

2. **API Password** (also called "Sign Key" or "API Key")
   - Usually found in: Settings → API Credentials
   - Or: Security → API Keys
   - **Important**: This is different from your login password!

3. **Base URL**:
   - **Sandbox**: `https://api.sandbox.datatrans.com`
   - **Production**: `https://api.datatrans.com`

**Note**: If you don't have a Datatrans account yet:
- Sign up at: https://www.datatrans.ch/en/
- Start with the sandbox/test environment first

---

## 🔒 **Step 5: Configure Datatrans Secrets in Supabase**

Set the Datatrans credentials as secrets in Supabase so the edge function can use them.

### **5.1: Set Secrets via CLI (Recommended)**

```bash
# Set your Datatrans Merchant ID
supabase secrets set DATATRANS_MERCHANT_ID=1110020919

# Set your Datatrans Password/API Key
supabase secrets set DATATRANS_PASSWORD=your_actual_password_here

# Set the base URL (sandbox for testing)
supabase secrets set DATATRANS_BASE_URL=https://api.sandbox.datatrans.com
```

**Replace**:
- `1110020919` with your actual Merchant ID
- `your_actual_password_here` with your actual API Password
- Use production URL when ready: `https://api.datatrans.com`

### **5.2: Verify Secrets Are Set**

```bash
# List all secrets (will show secret names, not values for security)
supabase secrets list
```

You should see:
- ✅ `DATATRANS_MERCHANT_ID`
- ✅ `DATATRANS_PASSWORD`
- ✅ `DATATRANS_BASE_URL`

### **5.3: Alternative: Set Secrets via Dashboard**

If CLI doesn't work, you can set secrets in the Supabase Dashboard:

1. Go to: https://supabase.com/dashboard/project/rvvujgbaswecqohixgog
2. Navigate to: **Settings** → **Edge Functions** → **Secrets**
3. Add each secret:
   - Name: `DATATRANS_MERCHANT_ID`, Value: `1110020919`
   - Name: `DATATRANS_PASSWORD`, Value: `your_password`
   - Name: `DATATRANS_BASE_URL`, Value: `https://api.sandbox.datatrans.com`

---

## ✅ **Step 6: Verify Deployment**

Check that everything is set up correctly.

### **6.1: Check in Supabase Dashboard**

1. Go to: https://supabase.com/dashboard/project/rvvujgbaswecqohixgog
2. Navigate to: **Edge Functions**
3. You should see: ✅ `datatrans-payment` (deployed)

### **6.2: Test the Function**

Test the deployed function using curl:

```bash
# Replace YOUR_ANON_KEY with your Supabase anon key
# Get it from: Supabase Dashboard → Settings → API → anon public key

curl -X POST https://rvvujgbaswecqohixgog.supabase.co/functions/v1/datatrans-payment \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "amount": 10.00,
    "currency": "CHF",
    "reference": "test-123",
    "cardNumber": "4242424242424242",
    "expiryMonth": "12",
    "expiryYear": "2025",
    "cvv": "123",
    "cardholderName": "Test User",
    "userId": "test-user-id"
  }'
```

**Expected Response** (if credentials are correct):
```json
{
  "success": true,
  "data": {
    "reference": "test-123",
    "status": "success",
    "transaction_id": "...",
    "amount": 10,
    "currency": "CHF"
  }
}
```

**If you get an error about credentials**:
- ✅ Check that secrets are set correctly
- ✅ Verify your Datatrans credentials are correct
- ✅ Make sure you're using the right environment (sandbox vs production)

---

## 🧪 **Step 7: Test Payment in Your App**

Now test the payment flow in your mobile app.

### **7.1: Test Card Numbers (Sandbox)**

For testing in sandbox mode, Datatrans provides test card numbers:

**Successful Payment**:
- Card: `4242424242424242`
- CVV: Any 3 digits (e.g., `123`)
- Expiry: Any future date (e.g., `12/2025`)

**Declined Payment**:
- Card: `4000000000000002`
- CVV: Any 3 digits
- Expiry: Any future date

### **7.2: Test in Your App**

1. **Open your app**
2. **Navigate to payment screen** (e.g., Add Payment Method)
3. **Enter test card details**:
   - Card Number: `4242424242424242`
   - Expiry: `12/2025`
   - CVV: `123`
   - Cardholder Name: `Test User`
   - Amount: `10.00`
4. **Submit payment**
5. **Check the result**:
   - ✅ Should show success message
   - ✅ Check Supabase Edge Function logs for details
   - ✅ Check Datatrans dashboard for transaction

### **7.3: Check Logs**

View function logs to debug:

1. **Via Dashboard**:
   - Go to: Supabase Dashboard → Edge Functions → `datatrans-payment` → Logs
   - See real-time logs of payment attempts

2. **Via CLI**:
   ```bash
   supabase functions logs datatrans-payment
   ```

---

## 🔄 **Step 8: Switch to Production (When Ready)**

When you're ready to accept real payments:

### **8.1: Get Production Credentials**

1. Get production Merchant ID from Datatrans
2. Get production API Password
3. Update secrets:

```bash
# Update to production URL
supabase secrets set DATATRANS_BASE_URL=https://api.datatrans.com

# Update to production Merchant ID
supabase secrets set DATATRANS_MERCHANT_ID=your_production_merchant_id

# Update to production Password
supabase secrets set DATATRANS_PASSWORD=your_production_password
```

### **8.2: Redeploy Function (if needed)**

```bash
supabase functions deploy datatrans-payment
```

---

## 🐛 **Troubleshooting**

### **Error: "Function not found" or 404**

**Problem**: Edge function is not deployed.

**Solution**:
```bash
supabase functions deploy datatrans-payment
```

---

### **Error: "Datatrans credentials not configured"**

**Problem**: Secrets are not set in Supabase.

**Solution**:
```bash
# Set all required secrets
supabase secrets set DATATRANS_MERCHANT_ID=your_merchant_id
supabase secrets set DATATRANS_PASSWORD=your_password
supabase secrets set DATATRANS_BASE_URL=https://api.sandbox.datatrans.com
```

---

### **Error: "Edge Function returned a non-2xx status code"**

**Possible Causes**:
1. Function not deployed → Deploy it
2. Missing secrets → Set secrets
3. Invalid Datatrans credentials → Verify credentials
4. Function code error → Check logs

**Solution**:
1. Check Supabase Dashboard → Edge Functions → Logs
2. Verify all secrets are set: `supabase secrets list`
3. Test with curl (see Step 6.2)
4. Verify Datatrans credentials in Datatrans dashboard

---

### **Error: "Payment failed" or "Invalid credentials"**

**Problem**: Datatrans credentials are incorrect.

**Solution**:
1. Double-check Merchant ID in Datatrans dashboard
2. Verify API Password (not login password!)
3. Make sure you're using the correct environment (sandbox vs production)
4. Test credentials directly with Datatrans API

---

### **Payment succeeds but app shows error**

**Problem**: Response parsing issue or network error.

**Solution**:
1. Check Edge Function logs in Supabase Dashboard
2. Check app console logs
3. Verify the function returns proper JSON format
4. Check network connectivity

---

## 📝 **Summary Checklist**

Use this checklist to ensure everything is set up:

- [ ] ✅ Supabase CLI installed (`supabase --version`)
- [ ] ✅ Logged in to Supabase (`supabase login`)
- [ ] ✅ Project linked (`supabase link --project-ref rvvujgbaswecqohixgog`)
- [ ] ✅ Edge function deployed (`supabase functions deploy datatrans-payment`)
- [ ] ✅ Datatrans account created/accessed
- [ ] ✅ Merchant ID obtained
- [ ] ✅ API Password obtained
- [ ] ✅ Secrets set in Supabase (`DATATRANS_MERCHANT_ID`, `DATATRANS_PASSWORD`, `DATATRANS_BASE_URL`)
- [ ] ✅ Function verified in Supabase Dashboard
- [ ] ✅ Test payment successful with test card
- [ ] ✅ Logs checked and working

---

## 🎯 **Quick Reference Commands**

```bash
# Install CLI
npm install -g supabase

# Login and link
supabase login
supabase link --project-ref rvvujgbaswecqohixgog

# Deploy function
supabase functions deploy datatrans-payment

# Set secrets
supabase secrets set DATATRANS_MERCHANT_ID=your_merchant_id
supabase secrets set DATATRANS_PASSWORD=your_password
supabase secrets set DATATRANS_BASE_URL=https://api.sandbox.datatrans.com

# Check secrets
supabase secrets list

# View logs
supabase functions logs datatrans-payment

# Test function
curl -X POST https://rvvujgbaswecqohixgog.supabase.co/functions/v1/datatrans-payment \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","amount":10,"currency":"CHF","reference":"test-123","cardNumber":"4242424242424242","expiryMonth":"12","expiryYear":"2025","cvv":"123","cardholderName":"Test User","userId":"test"}'
```

---

## 📚 **Additional Resources**

- **Supabase Edge Functions Docs**: https://supabase.com/docs/guides/functions
- **Datatrans API Reference**: https://api-reference.datatrans.ch/
- **Datatrans Dashboard (Sandbox)**: https://admin.sandbox.datatrans.com
- **Datatrans Dashboard (Production)**: https://admin.datatrans.com
- **Supabase Dashboard**: https://supabase.com/dashboard/project/rvvujgbaswecqohixgog

---

## 🎉 **You're Done!**

Once you complete all steps, your Datatrans payment integration will be fully functional. The app will:

1. ✅ Process payments via Supabase Edge Function
2. ✅ Use Datatrans API for payment processing
3. ✅ Handle errors gracefully
4. ✅ Save payment methods after successful payment
5. ✅ Show transaction status in real-time

**Need Help?** Check the troubleshooting section or review the Edge Function logs in Supabase Dashboard.

