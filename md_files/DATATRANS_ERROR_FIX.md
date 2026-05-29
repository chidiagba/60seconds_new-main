# 🔧 Fix Datatrans Edge Function 500 Error

## 🚨 **The Error You're Seeing**

```
ERROR: Edge Function returned a non-2xx status code
Status: 500
```

**What this means:**
- ✅ The function **IS deployed** (otherwise you'd get 404)
- ❌ The function **IS failing** when it tries to execute
- Most likely cause: **Missing or incorrect secrets** (DATATRANS credentials)

---

## 🔍 **Step-by-Step Fix**

### **Step 1: Check Function Logs in Supabase Dashboard**

This will tell you exactly what's wrong.

1. **Go to**: https://supabase.com/dashboard/project/rvvujgbaswecqohixgog
2. **Navigate to**: **Edge Functions** → **datatrans-payment**
3. **Click**: **Logs** tab
4. **Look for error messages** - you should see something like:
   - `❌ Datatrans credentials not configured`
   - Or a specific Datatrans API error

**This is the most important step** - the logs will tell you exactly what's wrong!

---

### **Step 2: Verify Secrets Are Set**

The function needs 3 secrets to work. Check if they're all set:

1. **In Supabase Dashboard**, go to: **Settings** → **Edge Functions** → **Secrets**
   - Or: **Edge Functions** → **datatrans-payment** → **Settings** → **Secrets**

2. **Verify these 3 secrets exist**:
   - ✅ `DATATRANS_MERCHANT_ID`
   - ✅ `DATATRANS_PASSWORD`
   - ✅ `DATATRANS_BASE_URL`

3. **If any are missing**, add them:
   - Click **"Add Secret"**
   - Enter the name exactly as shown (case-sensitive!)
   - Enter the value
   - Click **"Save"**

---

### **Step 3: Check Secret Values**

Make sure the values are correct:

#### **DATATRANS_MERCHANT_ID**
- Should be your Datatrans Merchant ID (e.g., `1110020919`)
- Get it from: https://admin.sandbox.datatrans.com (or production dashboard)
- **Not** your login username!

#### **DATATRANS_PASSWORD**
- Should be your Datatrans **API Password** (not your login password!)
- Get it from: Datatrans Dashboard → Settings → API Credentials
- **Important**: This is different from your login password!

#### **DATATRANS_BASE_URL**
- For testing: `https://api.sandbox.datatrans.com`
- For production: `https://api.datatrans.com`

---

### **Step 4: Common Issues & Fixes**

#### **Issue 1: "Datatrans credentials not configured"**

**Error in logs**: `❌ Datatrans credentials not configured`

**Fix**:
1. Go to Supabase Dashboard → Settings → Edge Functions → Secrets
2. Add all 3 secrets:
   - `DATATRANS_MERCHANT_ID` = your merchant ID
   - `DATATRANS_PASSWORD` = your API password
   - `DATATRANS_BASE_URL` = `https://api.sandbox.datatrans.com`

---

#### **Issue 2: "Invalid credentials" or "Authentication failed"**

**Error in logs**: Datatrans API returns 401 or 403

**Fix**:
1. **Double-check your Merchant ID** in Datatrans dashboard
2. **Verify your API Password** (not login password!)
3. **Make sure you're using the correct environment**:
   - Sandbox credentials → Sandbox URL
   - Production credentials → Production URL

---

#### **Issue 3: "Invalid card number" or payment validation errors**

**Error in logs**: Validation errors from the function

**Fix**:
- This is normal - the function validates input
- Make sure you're sending valid card data from your app
- Check the function logs to see which field is invalid

---

#### **Issue 4: Function code error**

**Error in logs**: JavaScript/TypeScript error

**Fix**:
1. Go to Edge Functions → `datatrans-payment` → **Code** tab
2. Make sure the code matches exactly what's in `supabase/functions/datatrans-payment/index.ts`
3. If different, copy the code from the file and update the function

---

### **Step 5: Test the Function**

After fixing secrets, test the function:

1. **In Supabase Dashboard**: Edge Functions → `datatrans-payment` → **Invoke** tab
2. **Enter test data**:

```json
{
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
}
```

3. **Click "Invoke"**
4. **Check the response**:
   - ✅ Success = secrets are correct!
   - ❌ Error = check the error message and logs

---

## 📋 **Quick Checklist**

Use this to verify everything:

- [ ] ✅ Function is deployed (appears in Edge Functions list)
- [ ] ✅ `DATATRANS_MERCHANT_ID` secret is set
- [ ] ✅ `DATATRANS_PASSWORD` secret is set
- [ ] ✅ `DATATRANS_BASE_URL` secret is set
- [ ] ✅ Secret names are exactly correct (case-sensitive)
- [ ] ✅ Merchant ID is correct (from Datatrans dashboard)
- [ ] ✅ API Password is correct (not login password!)
- [ ] ✅ Base URL matches your environment (sandbox vs production)
- [ ] ✅ Checked function logs for specific error
- [ ] ✅ Tested function with test data

---

## 🔍 **How to Read Function Logs**

1. **Go to**: Supabase Dashboard → Edge Functions → `datatrans-payment` → **Logs**

2. **Look for**:
   - `❌` = Errors (these tell you what's wrong)
   - `📤` = Outgoing requests (function calling Datatrans)
   - `📥` = Incoming responses (Datatrans response)
   - `✅` = Success messages

3. **Common log messages**:
   - `❌ Datatrans credentials not configured` → Missing secrets
   - `📤 Calling Datatrans API: ...` → Function is working, calling API
   - `❌ Datatrans API Error: ...` → Datatrans rejected the request (check credentials)
   - `✅ Payment SUCCESS` → Everything worked!

---

## 🎯 **Most Likely Solution**

Based on your error (500 status), the most common issue is:

**Missing or incorrect secrets**

**Quick Fix**:
1. Go to Supabase Dashboard → Settings → Edge Functions → Secrets
2. Verify all 3 secrets exist and have correct values
3. If missing, add them
4. Wait 1-2 minutes for secrets to propagate
5. Try your payment again

---

## 🆘 **Still Not Working?**

If you've checked everything above and it's still not working:

1. **Share the exact error from function logs** (Supabase Dashboard → Edge Functions → Logs)
2. **Verify Datatrans credentials work**:
   - Try logging into Datatrans dashboard
   - Check if your account is active
   - Verify API access is enabled

3. **Check function code**:
   - Make sure it matches `supabase/functions/datatrans-payment/index.ts`
   - No syntax errors
   - All imports are correct

---

## 📝 **Summary**

**Your Error**: Status 500 = Function deployed but failing

**Most Common Cause**: Missing secrets (DATATRANS_MERCHANT_ID, DATATRANS_PASSWORD)

**Quick Fix**:
1. Check Supabase Dashboard → Edge Functions → Logs (see exact error)
2. Verify all 3 secrets are set correctly
3. Test the function in dashboard
4. Try payment again in app

**Need More Help?** Share the exact error message from the function logs!

