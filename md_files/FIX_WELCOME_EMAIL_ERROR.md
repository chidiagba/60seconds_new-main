# 🔧 Fix Welcome Email Error - Step by Step Guide

## 🚨 **Current Error**

```
✅ Welcome email sent successfully to: email@example.com
ℹ️ Note: Email service configured but delivery failed - check logs
```

**This means**: Postmark API key is configured, but email delivery is failing.

---

## 🔍 **Step 1: Check Supabase Edge Function Logs**

1. **Go to**: https://supabase.com/dashboard/project/rvvujgbaswecqohixgog
2. **Navigate to**: **Edge Functions** → **send-welcome-email**
3. **Click**: **Logs** tab
4. **Look for**: Error messages (should show detailed Postmark errors now)

**Common errors you might see**:
- `422 Unprocessable Entity` - Email address not verified
- `401 Unauthorized` - Invalid API key
- `Invalid "From" address` - Sender email not verified

---

## ✅ **Step 2: Verify Postmark Configuration**

### **A. Check API Key**

1. **Go to**: https://postmarkapp.com
2. **Login** to your Postmark account
3. **Go to**: **Servers** → Select your server
4. **Click**: **API Tokens** tab
5. **Verify**: The Server API Token matches: `5beee648-004f-4a70-9f73-adf22890a9de`

### **B. Verify Sender Email Address**

**The function uses**: `welcome@60secondsapp.io`

**You need to verify this email in Postmark**:

1. **Go to**: Postmark Dashboard → **Signatures** (or **Senders**)
2. **Check if**: `welcome@60secondsapp.io` is verified
3. **If NOT verified**:
   - Click **Add Signature** or **Verify Domain**
   - Add `welcome@60secondsapp.io` as a sender
   - Verify the email address (Postmark will send a verification email)
   - OR verify the domain `60secondsapp.io` (recommended)

---

## 🔧 **Step 3: Fix Common Issues**

### **Issue 1: "From" Email Not Verified**

**Error**: `422 Unprocessable Entity - Invalid "From" address`

**Fix**:
1. **Option A**: Verify the email address in Postmark
   - Go to Postmark → Signatures
   - Add `welcome@60secondsapp.io`
   - Verify it

2. **Option B**: Change to a verified email (if you have one)
   - Update the function to use a verified email
   - Example: `noreply@yourdomain.com` (must be verified)

### **Issue 2: Invalid API Key**

**Error**: `401 Unauthorized`

**Fix**:
1. **Check** the API key in Supabase Dashboard → Edge Functions → Secrets
2. **Verify** it matches your Postmark Server Token
3. **Update** if incorrect:
   - Go to Supabase Dashboard → Edge Functions → Secrets
   - Edit `POSTMARK_API_KEY`
   - Enter correct value
   - Save

### **Issue 3: Domain Not Verified**

**Error**: `Domain not verified`

**Fix**:
1. **Go to**: Postmark → **Domains**
2. **Add domain**: `60secondsapp.io`
3. **Add DNS records** as instructed by Postmark
4. **Wait** for verification (can take a few minutes)

---

## 🚀 **Step 4: Redeploy Function**

After fixing the issue, redeploy the function:

1. **Via Dashboard**:
   - Go to Edge Functions → `send-welcome-email`
   - Click **Deploy** or **Update**

2. **Via CLI** (if installed):
   ```bash
   supabase functions deploy send-welcome-email
   ```

---

## ✅ **Step 5: Test Again**

1. **Sign up** a new user
2. **Check terminal** - should show: `✅ Welcome email sent via Supabase/Postmark`
3. **Check Supabase logs** - should show success with MessageID
4. **Check email inbox** - user should receive welcome email

---

## 📋 **Quick Checklist**

- [ ] Postmark API key is correct in Supabase secrets
- [ ] `welcome@60secondsapp.io` is verified in Postmark
- [ ] Domain `60secondsapp.io` is verified (if using domain)
- [ ] Function is redeployed after fixing issues
- [ ] Checked Supabase Edge Function logs for detailed errors

---

## 🆘 **Still Not Working?**

1. **Check Supabase Logs** for detailed error messages
2. **Check Postmark Dashboard** → **Activity** → See if emails are being attempted
3. **Try with a different email address** (use a real Gmail, not YOPmail)
4. **Verify the API key** is active in Postmark

---

## 📝 **Alternative: Use a Different "From" Email**

If `welcome@60secondsapp.io` can't be verified, you can change it:

1. **Update the function** to use a verified email
2. **Or** use Postmark's default sender (if available)

Let me know what error you see in the Supabase logs, and I'll help you fix it!

