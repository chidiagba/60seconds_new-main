# 🚀 Supabase Edge Functions Deployment Guide

## 📋 **Overview**

Your app uses **2 Supabase Edge Functions**:

1. **`send-welcome-email`** - Sends welcome emails to new users after signup
2. **`datatrans-payment`** - Handles payment processing via Datatrans

## 🔍 **Current Status**

- ✅ **Functions exist** in `supabase/functions/` directory
- ⚠️ **Functions need to be deployed** to Supabase
- ⚠️ **Email service needs configuration** for `send-welcome-email`

## 📦 **Edge Functions Summary**

### **1. send-welcome-email**
- **Location**: `supabase/functions/send-welcome-email/index.ts`
- **Purpose**: Sends welcome email from CEO after user registration
- **Called from**: `lib/auth.tsx` (after successful signup)
- **Status**: ⚠️ Needs deployment + email service configuration

### **2. datatrans-payment**
- **Location**: `supabase/functions/datatrans-payment/index.ts`
- **Purpose**: Processes payments via Datatrans payment gateway
- **Called from**: Payment-related code
- **Status**: ⚠️ Needs deployment + Datatrans credentials

---

## 🛠️ **Step-by-Step Deployment**

### **Prerequisites**

1. **Install Supabase CLI**:
   ```bash
   npm install -g supabase
   ```

2. **Login to Supabase**:
   ```bash
   supabase login
   ```

3. **Link to your project**:
   ```bash
   supabase link --project-ref rvvujgbaswecqohixgog
   ```

---

## 📧 **Deploy send-welcome-email Function**

### **Step 1: Deploy the Function**

```bash
supabase functions deploy send-welcome-email
```

### **Step 2: Configure Email Service (Choose One)**

#### **Option A: Supabase's Built-in Email (Postmark) - Recommended**

1. **Get Postmark API Key** from Supabase Dashboard:
   - Go to Settings → Auth → Email
   - Look for Postmark configuration or email provider settings
   - Copy the Server Token/API Key
2. **Set Secret in Supabase**:
   ```bash
   supabase secrets set POSTMARK_API_KEY=your_postmark_server_token_here
   ```
3. **The function is already configured** to use Postmark (no code changes needed)

#### **Option B: Resend (Alternative)**

1. **Sign up at Resend**: https://resend.com
2. **Get API Key** from dashboard
3. **Set Secret in Supabase**:
   ```bash
   supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxx
   ```
4. **The function will automatically use Resend** if Postmark is not configured

### **Step 3: Test the Function**

```bash
# Test locally (if you have Supabase running locally)
curl -X POST http://localhost:54321/functions/v1/send-welcome-email \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "name": "Test User"}'

# Test on production
curl -X POST https://rvvujgbaswecqohixgog.supabase.co/functions/v1/send-welcome-email \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "name": "Test User"}'
```

---

## 💳 **Deploy datatrans-payment Function**

### **Step 1: Deploy the Function**

```bash
supabase functions deploy datatrans-payment
```

### **Step 2: Configure Datatrans Credentials**

1. **Get Datatrans credentials** from your Datatrans account
2. **Set Secrets in Supabase**:
   ```bash
   supabase secrets set DATATRANS_MERCHANT_ID=your_merchant_id
   supabase secrets set DATATRANS_PASSWORD=your_password
   supabase secrets set DATATRANS_BASE_URL=https://api.sandbox.datatrans.com
   ```

### **Step 3: Test the Function**

```bash
# Test on production
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
    "userId": "user-id-here"
  }'
```

---

## 🚀 **Quick Deploy All Functions**

Deploy both functions at once:

```bash
# Deploy send-welcome-email
supabase functions deploy send-welcome-email

# Deploy datatrans-payment
supabase functions deploy datatrans-payment
```

---

## ✅ **Verify Deployment**

### **Check in Supabase Dashboard**

1. **Go to**: https://supabase.com/dashboard/project/rvvujgbaswecqohixgog
2. **Navigate to**: Edge Functions
3. **You should see**:
   - ✅ `send-welcome-email` (deployed)
   - ✅ `datatrans-payment` (deployed)

### **Check Function Logs**

1. **Go to**: Edge Functions → `send-welcome-email` → Logs
2. **Check for errors** or successful invocations

---

## 🔧 **Troubleshooting**

### **Error: "Function not found" or 404**

**Solution**: The function is not deployed. Deploy it using:
```bash
supabase functions deploy send-welcome-email
```

### **Error: "Edge Function returned a non-2xx status code"**

**Possible causes**:
1. Function not deployed → Deploy the function
2. Missing secrets → Set required secrets
3. Function error → Check logs in Supabase Dashboard

**Solution**:
1. Check Supabase Dashboard → Edge Functions → Logs
2. Verify all required secrets are set
3. Test the function manually using curl

### **Error: "Email service not configured"**

**Solution**: Configure an email service (Resend or SendGrid) and set the API key:
```bash
supabase secrets set RESEND_API_KEY=your_key_here
```

### **Error: "Datatrans credentials not configured"**

**Solution**: Set Datatrans credentials:
```bash
supabase secrets set DATATRANS_MERCHANT_ID=your_id
supabase secrets set DATATRANS_PASSWORD=your_password
```

---

## 📝 **Function Code Locations**

All edge functions are located in:
```
supabase/functions/
├── send-welcome-email/
│   └── index.ts
└── datatrans-payment/
    └── index.ts
```

---

## 🎯 **After Deployment**

Once deployed, your app will:
1. ✅ **Automatically send welcome emails** after user signup
2. ✅ **Process payments** via Datatrans
3. ✅ **Handle errors gracefully** (won't break signup if email fails)

---

## 📚 **Additional Resources**

- **Supabase Edge Functions Docs**: https://supabase.com/docs/guides/functions
- **Resend API Docs**: https://resend.com/docs
- **SendGrid API Docs**: https://docs.sendgrid.com/
- **Datatrans API Docs**: https://api-reference.datatrans.ch/

---

## 🎉 **Summary**

**Total Edge Functions**: 2
1. `send-welcome-email` - Welcome emails
2. `datatrans-payment` - Payment processing

**Deployment Command**:
```bash
supabase functions deploy send-welcome-email
supabase functions deploy datatrans-payment
```

**Required Secrets**:
- `POSTMARK_API_KEY` (for send-welcome-email - Supabase's built-in email) OR `RESEND_API_KEY` (alternative)
- `DATATRANS_MERCHANT_ID` (for datatrans-payment)
- `DATATRANS_PASSWORD` (for datatrans-payment)

