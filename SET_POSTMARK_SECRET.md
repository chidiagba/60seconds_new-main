# Set Postmark API Key in Supabase

## Your Postmark API Key:
```
5beee648-004f-4a70-9f73-adf22890a9de
```

## Method 1: Via Supabase Dashboard (Easiest)

1. **Go to**: https://supabase.com/dashboard/project/rvvujgbaswecqohixgog
2. **Navigate to**: **Project Settings** → **Edge Functions** → **Secrets**
3. **Click**: **Add Secret**
4. **Enter**:
   - **Name**: `POSTMARK_API_KEY`
   - **Value**: `5beee648-004f-4a70-9f73-adf22890a9de`
5. **Click**: **Save**

## Method 2: Via Supabase CLI (If installed)

If you have Supabase CLI installed via Homebrew:

```bash
supabase secrets set POSTMARK_API_KEY=5beee648-004f-4a70-9f73-adf22890a9de
```

## After Setting the Secret

1. **Deploy the function**:
   ```bash
   supabase functions deploy send-welcome-email
   ```

2. **Or deploy via Dashboard**:
   - Go to **Edge Functions** → **send-welcome-email**
   - Click **Deploy** or **Update**

## Test It

After deployment, sign up a new user and check:
- ✅ Terminal should show: `✅ Welcome email sent via Supabase/Postmark`
- ✅ User should receive welcome email in their inbox

