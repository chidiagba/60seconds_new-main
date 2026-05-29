# 📧 Supabase Built-in Email Setup (Postmark)

## ✅ **Updated: Now Using Supabase's Built-in Email Service**

The welcome email function now uses **Supabase's built-in email service (Postmark)** instead of SendGrid.

---

## 🔧 **How to Get Postmark API Key from Supabase**

### **Step 1: Access Supabase Dashboard**

1. **Go to**: https://supabase.com/dashboard/project/rvvujgbaswecqohixgog
2. **Navigate to**: Settings → API

### **Step 2: Get Postmark API Key**

Supabase uses Postmark internally for sending emails. To get your Postmark API key:

1. **Go to**: Settings → Auth → Email Templates
2. **Look for**: Postmark configuration or email service settings
3. **OR**: Check your Supabase project's email service provider settings

**Note**: If you don't see Postmark API key directly, you may need to:

1. **Check Supabase Email Settings**:
   - Go to Settings → Auth
   - Look for "Email Provider" or "SMTP Settings"
   - Supabase uses Postmark by default for transactional emails

2. **Alternative**: Use the Postmark Server Token from your Supabase project's email configuration

### **Step 3: Set the Secret**

Once you have the Postmark API key (Server Token), set it as a secret:

```bash
supabase secrets set POSTMARK_API_KEY=your_postmark_server_token_here
```

---

## 🚀 **Quick Setup**

### **Option 1: Use Supabase's Postmark (Recommended)**

```bash
# 1. Get Postmark API key from Supabase Dashboard
# 2. Set it as a secret:
supabase secrets set POSTMARK_API_KEY=your_postmark_token

# 3. Deploy the function:
supabase functions deploy send-welcome-email
```

### **Option 2: Use Resend (Alternative)**

If you prefer Resend instead:

```bash
# Get API key from https://resend.com
supabase secrets set RESEND_API_KEY=re_your_api_key_here

# Deploy the function:
supabase functions deploy send-welcome-email
```

---

## 📋 **How It Works**

1. **Function tries Postmark first** (Supabase's built-in email service)
2. **Falls back to Resend** if Postmark is not configured
3. **Logs email** if neither is configured (for development)

---

## 🔍 **Finding Your Postmark API Key**

### **Method 1: From Supabase Dashboard**

1. Go to your Supabase project dashboard
2. Navigate to **Settings** → **Auth** → **Email**
3. Look for Postmark configuration or email provider settings
4. Copy the Server Token or API Key

### **Method 2: From Supabase CLI**

```bash
# List all secrets to see if Postmark is already configured
supabase secrets list
```

### **Method 3: Check Email Logs**

1. Go to **Edge Functions** → **Logs**
2. Check for any Postmark-related configuration or errors

---

## ✅ **Verify Configuration**

After setting the secret, test the function:

```bash
# Test the function
curl -X POST https://rvvujgbaswecqohixgog.supabase.co/functions/v1/send-welcome-email \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "name": "Test User"}'
```

---

## 🎯 **What Changed**

- ✅ **Removed**: SendGrid support
- ✅ **Added**: Supabase's Postmark (built-in email service)
- ✅ **Kept**: Resend as alternative option
- ✅ **Improved**: Better error handling and logging

---

## 📝 **Current Email Service Priority**

1. **Postmark** (Supabase's built-in) - Primary
2. **Resend** - Fallback option
3. **Logging** - Development/testing fallback

---

## 🚨 **Important Notes**

- **Postmark is Supabase's default email service** for transactional emails
- **You may need to verify your domain** in Supabase/Postmark settings
- **Check Supabase Dashboard** for email service configuration
- **The "from" email address** must be verified in your Postmark account

---

## 🔧 **Troubleshooting**

### **Error: "Postmark API error"**

1. **Verify API key is correct**:
   ```bash
   supabase secrets list
   ```

2. **Check Postmark account**:
   - Ensure your Postmark account is active
   - Verify the Server Token is correct

3. **Check email address**:
   - The "from" address must be verified in Postmark
   - Use a verified sender signature

### **Email not sending**

1. **Check function logs** in Supabase Dashboard
2. **Verify secret is set**:
   ```bash
   supabase secrets list
   ```
3. **Test with curl** (see above)

---

## 📚 **Resources**

- **Supabase Email Docs**: https://supabase.com/docs/guides/auth/auth-email
- **Postmark API Docs**: https://postmarkapp.com/developer/api/email-api
- **Resend Docs**: https://resend.com/docs

---

## ✅ **Summary**

Your welcome email function now:
- ✅ Uses **Supabase's built-in Postmark** email service (primary)
- ✅ Falls back to **Resend** if Postmark is not configured
- ✅ **No SendGrid** dependency
- ✅ Better error handling and logging

**Next Step**: Get your Postmark API key from Supabase Dashboard and set it as a secret!

