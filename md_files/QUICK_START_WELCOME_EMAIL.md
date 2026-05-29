# Quick Start: Welcome Email Setup

## Current Status

✅ **Code is ready** - The signup flow will automatically try to send welcome emails
⚠️ **Edge Function needs deployment** - The function exists but needs to be deployed to Supabase
⚠️ **Email service needed** - Currently just logs emails (needs Resend/SendGrid/etc.)

## What Happens Now When You Signup?

When a new user signs up:
1. ✅ Account is created successfully
2. ✅ Code tries to call the Edge Function
3. ⚠️ Edge Function might not be deployed yet → Will log a warning (non-blocking)
4. ⚠️ Even if deployed, email is just logged (not actually sent) until you add an email service

## Quick Setup (5 minutes)

### Option 1: Use Resend (Easiest - Recommended)

1. **Sign up for Resend** (free tier available):
   - Go to https://resend.com
   - Sign up and verify your email
   - Get your API key from the dashboard

2. **Update the Edge Function** to use Resend:
   - Open `supabase/functions/send-welcome-email/index.ts`
   - Find the "Option 1: Resend" section (around line 100)
   - Uncomment the Resend code (remove the `//` comments)

3. **Deploy the Edge Function**:
   ```bash
   # Install Supabase CLI if needed
   npm install -g supabase
   
   # Login to Supabase
   supabase login
   
   # Link to your project
   supabase link --project-ref rvvujgbaswecqohixgog
   
   # Set the Resend API key as a secret
   supabase secrets set RESEND_API_KEY=re_your_api_key_here
   
   # Deploy the function
   supabase functions deploy send-welcome-email
   ```

4. **Test it**:
   - Sign up with a new user
   - Check your email inbox
   - Check Supabase Dashboard → Edge Functions → Logs for any errors

### Option 2: Test Without Email Service (Just Logging)

If you just want to test the flow without setting up an email service:

1. **Deploy the Edge Function** (it will just log emails for now):
   ```bash
   npm install -g supabase
   supabase login
   supabase link --project-ref rvvujgbaswecqohixgog
   supabase functions deploy send-welcome-email
   ```

2. **Test signup**:
   - Sign up with a new user
   - Check the Supabase Dashboard → Edge Functions → Logs
   - You'll see the email content logged there

3. **Add email service later** when ready

## Verify It's Working

After deployment, when you signup:

1. **Check app console** - Should see: `✅ Welcome email sent successfully to: user@email.com`
2. **Check Supabase Dashboard**:
   - Go to Edge Functions → `send-welcome-email` → Logs
   - You should see the email being processed
3. **Check your email inbox** (if email service is configured)

## Troubleshooting

### "Function not found" error
- **Solution**: Deploy the Edge Function first (see steps above)

### "Failed to send welcome email" warning
- **Solution**: Check Supabase Dashboard → Edge Functions → Logs for details
- Make sure the Edge Function is deployed
- If using an email service, verify the API key is set correctly

### Email not received
- **Check**: Is the email service code uncommented in the Edge Function?
- **Check**: Is the API key set correctly? `supabase secrets list`
- **Check**: Check spam folder
- **Check**: Verify email service dashboard for sent emails

## Current Code Flow

```
User Signs Up
    ↓
Account Created in Supabase
    ↓
Code calls: supabase.functions.invoke('send-welcome-email')
    ↓
Edge Function receives request
    ↓
[If email service configured] → Sends email via Resend/SendGrid/etc.
[If not configured] → Logs email to console
    ↓
User receives welcome email (if service configured)
```

## Next Steps

1. **Deploy the Edge Function** (required)
2. **Choose an email service** (Resend recommended)
3. **Uncomment the email service code** in the Edge Function
4. **Set the API key** as a Supabase secret
5. **Test with a real signup**

The code is ready - you just need to deploy and configure the email service!










