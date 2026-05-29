# 🔧 Fix: Datatrans Edge Function 500 Error

## 🚨 **Your Error**

```
ERROR: Edge Function returned a non-2xx status code
Status: 500
```

## ✅ **What This Means**

- ✅ **Function IS deployed** (if it wasn't, you'd get 404)
- ❌ **Function IS failing** when executing (status 500 = server error)
- **Most likely cause**: Missing or incorrect Datatrans secrets

---

## 🎯 **Quick Fix (3 Steps)**

### **Step 1: Check Function Logs** ⭐ **MOST IMPORTANT**

This will show you the exact error:

1. Go to: https://supabase.com/dashboard/project/rvvujgbaswecqohixgog
2. Click: **Edge Functions** (left sidebar)
3. Click: **datatrans-payment**
4. Click: **Logs** tab
5. **Look for the error message** - it will tell you exactly what's wrong!

**Common errors you'll see:**
- `❌ Datatrans credentials not configured` → Missing secrets
- `❌ Datatrans API Error: Authentication failed` → Wrong credentials
- `❌ Invalid Merchant ID` → Wrong Merchant ID

---

### **Step 2: Set Missing Secrets**

The function needs 3 secrets. Set them in Supabase Dashboard:

1. **Go to**: Supabase Dashboard → **Settings** → **Edge Functions** → **Secrets**
   - Or: **Edge Functions** → **datatrans-payment** → **Settings** → **Secrets**

2. **Add these 3 secrets** (if missing):

   **Secret 1:**
   - Name: `DATATRANS_MERCHANT_ID`
   - Value: Your Datatrans Merchant ID (e.g., `1110020919`)
   - Click **"Save"**

   **Secret 2:**
   - Name: `DATATRANS_PASSWORD`
   - Value: Your Datatrans API Password (NOT your login password!)
   - Click **"Save"**

   **Secret 3:**
   - Name: `DATATRANS_BASE_URL`
   - Value: `https://api.sandbox.datatrans.com` (for testing)
   - Or: `https://api.datatrans.com` (for production)
   - Click **"Save"**

3. **Verify all 3 are listed**:
   - ✅ `DATATRANS_MERCHANT_ID`
   - ✅ `DATATRANS_PASSWORD`
   - ✅ `DATATRANS_BASE_URL`

---

### **Step 3: Get Your Datatrans Credentials**

If you don't have them yet:

1. **Go to Datatrans Dashboard**:
   - **Sandbox**: https://admin.sandbox.datatrans.com/Login.jsp
   - **Production**: https://admin.datatrans.com/Login.jsp

2. **Find your credentials**:
   - **Merchant ID**: Settings → Merchant Information
   - **API Password**: Settings → API Credentials (different from login password!)

3. **Copy them** and add as secrets in Supabase (Step 2)

---

## 🧪 **Test After Fixing**

1. **Wait 1-2 minutes** for secrets to propagate
2. **Try payment again** in your app
3. **Check logs** if it still fails

---

## 📋 **Complete Checklist**

- [ ] ✅ Checked function logs in Supabase Dashboard
- [ ] ✅ Found the exact error message
- [ ] ✅ `DATATRANS_MERCHANT_ID` secret is set
- [ ] ✅ `DATATRANS_PASSWORD` secret is set
- [ ] ✅ `DATATRANS_BASE_URL` secret is set
- [ ] ✅ Secret names are exactly correct (case-sensitive)
- [ ] ✅ Merchant ID is correct (from Datatrans dashboard)
- [ ] ✅ API Password is correct (not login password!)
- [ ] ✅ Base URL matches environment (sandbox vs production)
- [ ] ✅ Waited 1-2 minutes after setting secrets
- [ ] ✅ Tested payment again

---

## 🔍 **Understanding the Error**

**Status 500** means:
- The function exists and was called
- But something went wrong during execution
- Usually: Missing secrets or invalid credentials

**NOT Status 404** (which would mean function not deployed)

---

## 🆘 **Still Getting 500 Error?**

1. **Check the exact error in logs** (Step 1 above)
2. **Verify secrets are correct**:
   - Merchant ID matches Datatrans dashboard
   - API Password is the API password (not login password)
   - Base URL matches your environment
3. **Test the function directly**:
   - Go to Edge Functions → datatrans-payment → Invoke tab
   - Enter test data and click "Invoke"
   - See what error it returns

---

## 📝 **Summary**

**Your Issue**: Status 500 = Function deployed but failing

**Most Likely Cause**: Missing secrets

**Fix**:
1. Check logs to see exact error
2. Set all 3 secrets in Supabase Dashboard
3. Verify credentials are correct
4. Test again

**Need Help?** Share the exact error message from the function logs!

