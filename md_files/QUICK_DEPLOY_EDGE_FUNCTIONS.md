# ⚡ Quick Deploy: Edge Functions

## 🚨 **The Error You're Seeing**

```
⚠️ Failed to send welcome email (non-blocking): [FunctionsHttpError: Edge Function returned a non-2xx status code]
```

**This means**: The edge function is not deployed to Supabase yet.

---

## ✅ **Quick Fix (5 Minutes)**

### **Step 1: Install & Login**

```bash
# Install Supabase CLI (if not installed)
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref rvvujgbaswecqohixgog
```

### **Step 2: Deploy the Function**

```bash
# Deploy welcome email function
supabase functions deploy send-welcome-email
```

### **Step 3: Configure Email Service (Choose One)**

#### **Option A: Supabase's Built-in Email (Postmark) - Recommended**

```bash
# Get Postmark API key from Supabase Dashboard
# Settings → Auth → Email (or check your email provider settings)
# Then set it as a secret:
supabase secrets set POSTMARK_API_KEY=your_postmark_server_token_here
```

#### **Option B: Resend (Alternative)**

```bash
# Get API key from https://resend.com
# Then set it as a secret:
supabase secrets set RESEND_API_KEY=re_your_api_key_here
```

### **Step 4: Test**

1. **Sign up a new user** in your app
2. **Check the terminal** - should see: `✅ Welcome email sent successfully`
3. **Check email inbox** - should receive welcome email

---

## 📋 **All Edge Functions in Your App**

You have **2 edge functions**:

### **1. send-welcome-email**
- **Location**: `supabase/functions/send-welcome-email/index.ts`
- **Deploy**: `supabase functions deploy send-welcome-email`
- **Secrets needed**: `RESEND_API_KEY` or `SENDGRID_API_KEY`

### **2. datatrans-payment**
- **Location**: `supabase/functions/datatrans-payment/index.ts`
- **Deploy**: `supabase functions deploy datatrans-payment`
- **Secrets needed**: 
  - `DATATRANS_MERCHANT_ID`
  - `DATATRANS_PASSWORD`
  - `DATATRANS_BASE_URL` (optional)

---

## 🚀 **Deploy All Functions at Once**

```bash
# Deploy both functions
supabase functions deploy send-welcome-email
supabase functions deploy datatrans-payment
```

---

## ✅ **Verify Deployment**

1. **Go to**: https://supabase.com/dashboard/project/rvvujgbaswecqohixgog
2. **Click**: Edge Functions
3. **You should see**:
   - ✅ `send-welcome-email` (deployed)
   - ✅ `datatrans-payment` (deployed)

---

## 🔧 **Troubleshooting**

### **Still getting "Function not found" error?**

1. **Check deployment**:
   ```bash
   supabase functions list
   ```

2. **Redeploy**:
   ```bash
   supabase functions deploy send-welcome-email
   ```

3. **Check logs** in Supabase Dashboard → Edge Functions → Logs

### **Email not sending?**

1. **Check if secret is set**:
   ```bash
   supabase secrets list
   ```

2. **Set the secret again** (choose one):
   ```bash
   # For Supabase's built-in email (Postmark):
   supabase secrets set POSTMARK_API_KEY=your_postmark_token_here
   
   # OR for Resend:
   supabase secrets set RESEND_API_KEY=your_resend_key_here
   ```

3. **Check function logs** in Supabase Dashboard

---

## 📝 **Copy-Paste Commands**

**For Welcome Email (Most Important):**

```bash
# 1. Install CLI
npm install -g supabase

# 2. Login
supabase login

# 3. Link project
supabase link --project-ref rvvujgbaswecqohixgog

# 4. Deploy function
supabase functions deploy send-welcome-email

# 5. Set email service (choose one)
supabase secrets set RESEND_API_KEY=re_your_key_here
# OR
supabase secrets set SENDGRID_API_KEY=SG.your_key_here
```

**For Payment Processing:**

```bash
# Deploy payment function
supabase functions deploy datatrans-payment

# Set Datatrans credentials
supabase secrets set DATATRANS_MERCHANT_ID=your_merchant_id
supabase secrets set DATATRANS_PASSWORD=your_password
```

---

## 🎯 **After Deployment**

✅ **Welcome emails will work automatically** after user signup  
✅ **Error handling is improved** - won't break signup if email fails  
✅ **Better error messages** in console for debugging

---

## 📚 **Full Documentation**

See `EDGE_FUNCTIONS_DEPLOYMENT_GUIDE.md` for complete details.

