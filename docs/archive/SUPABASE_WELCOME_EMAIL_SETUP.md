# Supabase Welcome Email Setup

## Overview

The welcome email is now implemented using **Supabase Edge Functions**, which is the recommended approach when using Supabase. The Edge Function is located at `supabase/functions/send-welcome-email/index.ts`.

## Current Implementation

✅ **Edge Function Created**: `supabase/functions/send-welcome-email/index.ts`
✅ **Signup Integration**: Automatically calls the Edge Function after signup
✅ **Email Template**: Uses your exact template
⚠️ **Email Service**: Currently logs to console (needs email service integration)

## How It Works

1. User signs up → Account created in Supabase
2. Signup flow automatically calls the Edge Function
3. Edge Function sends welcome email via email service
4. Non-blocking (won't break signup if email fails)

## Deploying the Edge Function

### Step 1: Install Supabase CLI (if not already installed)

```bash
npm install -g supabase
```

### Step 2: Login to Supabase

```bash
supabase login
```

### Step 3: Link to your project

```bash
supabase link --project-ref rvvujgbaswecqohixgog
```

### Step 4: Deploy the Edge Function

```bash
supabase functions deploy send-welcome-email
```

## Setting Up Email Service

The Edge Function supports multiple email providers. Choose one:

### Option 1: Resend (Recommended - Easiest)

1. **Sign up at Resend**: https://resend.com
2. **Get API Key** from dashboard
3. **Set Secret in Supabase**:
   ```bash
   supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxx
   ```
4. **Uncomment Resend code** in `supabase/functions/send-welcome-email/index.ts`:
   ```typescript
   // Find the "Option 1: Resend" section and uncomment it
   ```

### Option 2: SendGrid

1. **Sign up at SendGrid**: https://sendgrid.com
2. **Get API Key** from dashboard
3. **Set Secret in Supabase**:
   ```bash
   supabase secrets set SENDGRID_API_KEY=SG.xxxxxxxxxxxxx
   ```
4. **Uncomment SendGrid code** in the Edge Function

### Option 3: AWS SES

1. **Set up AWS SES**
2. **Set Secrets in Supabase**:
   ```bash
   supabase secrets set AWS_ACCESS_KEY_ID=xxxxxxxxxxxxx
   supabase secrets set AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxx
   supabase secrets set AWS_REGION=us-east-1
   ```
3. **Add AWS SDK code** to the Edge Function

## Testing the Edge Function

### Test Locally

```bash
# Start Supabase locally
supabase start

# Test the function
curl -X POST http://localhost:54321/functions/v1/send-welcome-email \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","name":"Test User"}'
```

### Test in Production

After deploying, test via your app's signup flow or directly:

```bash
curl -X POST https://rvvujgbaswecqohixgog.supabase.co/functions/v1/send-welcome-email \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","name":"Test User"}'
```

## Using Database Triggers (Alternative)

You can also trigger the welcome email automatically when a user is created using a database trigger:

```sql
-- Create a function to call the Edge Function
CREATE OR REPLACE FUNCTION send_welcome_email()
RETURNS TRIGGER AS $$
BEGIN
  -- Call the Edge Function via HTTP
  PERFORM
    net.http_post(
      url := 'https://rvvujgbaswecqohixgog.supabase.co/functions/v1/send-welcome-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object(
        'email', NEW.email,
        'name', COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
      )
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on user creation
CREATE TRIGGER on_user_created_send_welcome_email
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION send_welcome_email();
```

## Environment Variables

Set these in Supabase Dashboard → Project Settings → Edge Functions → Secrets:

- `RESEND_API_KEY` (if using Resend)
- `SENDGRID_API_KEY` (if using SendGrid)
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (if using AWS SES)

## Current Status

- ✅ Edge Function created
- ✅ Signup flow integrated
- ✅ Email template ready
- ⚠️ Email service integration needed (uncomment code in Edge Function)

## Next Steps

1. Choose an email service provider (Resend recommended)
2. Get API key
3. Set secret in Supabase: `supabase secrets set RESEND_API_KEY=your_key`
4. Uncomment the email service code in the Edge Function
5. Deploy: `supabase functions deploy send-welcome-email`
6. Test by signing up a new user

## Benefits of Using Supabase Edge Functions

- ✅ Native Supabase integration
- ✅ Secure (secrets managed by Supabase)
- ✅ Scalable (serverless)
- ✅ No separate backend needed
- ✅ Can be triggered from client or database triggers
- ✅ Built-in logging and monitoring










