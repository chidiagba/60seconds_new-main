# Deploy Password Reset Edge Functions

## Quick Deployment Steps

### 1. Deploy get-uid-by-email function

```bash
cd /Users/mohib/Downloads/60seconds
supabase functions deploy get-uid-by-email
```

### 2. Deploy update-password-by-uid function

```bash
supabase functions deploy update-password-by-uid
```

### 3. Set Environment Variables (Secrets)

Make sure these secrets are set in Supabase Dashboard:

1. Go to: https://supabase.com/dashboard/project/rvvujgbaswecqohixgog/settings/functions
2. Set the following secrets:
   - `SUPABASE_URL` = `https://rvvujgbaswecqohixgog.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = (Your service role key from Settings → API)

Or use CLI:
```bash
supabase secrets set SUPABASE_URL=https://rvvujgbaswecqohixgog.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

## Testing

1. Open the app on Android device
2. Go to Forgot Password screen
3. Enter a valid email address
4. Should navigate to Reset Password screen
5. Enter new password
6. Password should be updated successfully

## Troubleshooting

If you see "No account found with this email address":
- Check Supabase logs: Dashboard → Edge Functions → Logs
- Verify the email exists in Supabase Auth users
- Check that secrets are set correctly
- Verify the edge function is deployed
