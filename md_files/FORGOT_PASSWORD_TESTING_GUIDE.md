# Forgot Password Testing Guide

This guide will help you test the forgot password functionality in your app.

## Overview

The forgot password flow works as follows:
1. User clicks "Forgot Password?" on the login screen
2. User enters their email address
3. Supabase sends a password reset email
4. User clicks the reset link in the email
5. User enters a new password
6. Password is updated successfully

## Prerequisites

1. **Have a test user account** - Make sure you have a user account registered in your Supabase database
2. **Email access** - You need access to the email address associated with the test account
3. **Development server running** - Your app should be running (either Expo or web)
4. **Static file server running** - You need to run the static file server on port 3000:
   ```bash
   npm run start-static
   # or
   node start-static-server.js
   ```
   This server serves the password reset HTML pages.

## Step-by-Step Testing Instructions

### Step 1: Navigate to Login Screen

1. Open your app
2. Navigate to the Sign In screen (`/signin`)
3. You should see a "Forgot Password?" link below the password field

### Step 2: Request Password Reset

1. Click on the "Forgot Password?" link
2. You should be redirected to the Forgot Password screen (`/forgot-password`)
3. Enter the email address of your test user account
4. Click "Send Reset Link"
5. You should see a success message: "Reset Email Sent"

### Step 3: Check Your Email

1. Open the email inbox for the test account
2. Look for an email from Supabase with subject "Reset Your Password" or similar
3. **Note**: If you're in development mode, emails might:
   - Go to spam folder
   - Be delayed by a few minutes
   - Not be sent if Supabase email service is not configured

### Step 4: Access the Reset Link

**IMPORTANT**: Make sure the static file server is running on port 3000:
```bash
npm run start-static
```

The reset email will contain a link that looks like:
```
https://rvvujgbaswecqohixgog.supabase.co/auth/v1/verify?token=...&type=recovery&redirect_to=http://localhost:3000/
```

**How it works**:
1. Click the link in the email
2. Supabase redirects to `http://localhost:3000/` with tokens in the URL hash
3. The `public/index.html` page detects it's a password reset and redirects to `reset-password.html`
4. The `reset-password.html` page handles the password reset

### Step 5: Reset Your Password

1. **Click the reset link from the email**
   - It will open in your browser (or the app if configured)
   - You should see the password reset page at `http://localhost:3000/reset-password.html`

2. **Enter a new password** that meets the requirements:
   - At least 8 characters
   - One uppercase letter
   - One lowercase letter
   - One number
   - One special character (!@#$%^&*(),.?":{}|<>)
4. Confirm the new password
5. Click "Update Password"
6. You should see a success message

### Step 6: Verify Password Reset

1. Go back to the Sign In screen
2. Try signing in with:
   - Email: Your test account email
   - Password: Your NEW password
3. You should be able to sign in successfully

## Testing Scenarios

### ✅ Happy Path
- Valid email address
- Email is received
- Reset link works
- New password meets requirements
- Can sign in with new password

### ❌ Error Cases to Test

1. **Invalid Email Format**
   - Enter an invalid email (e.g., "test@")
   - Should show validation error

2. **Non-existent Email**
   - Enter an email that doesn't exist in the system
   - Supabase will still send a success response (for security)
   - No email will be received

3. **Expired Reset Link**
   - Wait for the reset link to expire (usually 1 hour)
   - Try to use the expired link
   - Should show an error message

4. **Weak Password**
   - Try to set a password that doesn't meet requirements
   - Should show validation errors

5. **Password Mismatch**
   - Enter different passwords in "New Password" and "Confirm Password"
   - Should show "Passwords do not match" error

## Development/Testing Tips

### If Emails Are Not Being Sent

1. **Check Supabase Dashboard**:
   - Go to your Supabase project dashboard
   - Navigate to Authentication > Email Templates
   - Check if email service is configured

2. **Check Supabase Logs**:
   - Go to Logs > Auth Logs in Supabase dashboard
   - Look for password reset requests

3. **Use Supabase Local Development**:
   - If using Supabase locally, emails might be logged to console instead of sent

4. **Check Spam Folder**:
   - Password reset emails often go to spam

### Testing Without Email (Advanced)

If you need to test without actual emails, you can:

1. **Check Supabase Auth Logs**:
   - The reset token might be visible in logs
   - You can manually construct the reset URL

2. **Use Supabase CLI**:
   ```bash
   # Check auth logs
   supabase logs auth
   ```

3. **Direct Database Query** (for testing only):
   - Check the `auth.users` table for reset tokens
   - **Warning**: This is for development only!

## Current Configuration

Based on your code:
- **Reset URL**: `http://localhost:3000/` (see `lib/auth.tsx:321`)
- **Static Server**: Port 3000 (run with `npm run start-static`)
- **Reset Page**: `public/reset-password.html` (handles password reset in browser)
- **Redirect Handler**: `public/index.html` (detects password reset and redirects)
- **Email Service**: Supabase Auth (default email service)

## Troubleshooting

### Issue: Reset link doesn't open the app
- **Solution**: 
  - Make sure your app is installed and the deep link scheme `myapp://` is configured
  - On iOS: The app should be installed and the URL scheme registered
  - On Android: The app should be installed and the intent filter configured
  - Try manually opening `myapp://reset-password` in a browser to test if deep links work

### Issue: Reset link shows "connection refused" or doesn't work
- **Solution**: 
  - **Make sure the static file server is running on port 3000**
  - Run: `npm run start-static` or `node start-static-server.js`
  - The server must be running before you click the reset link
  - Check that port 3000 is not being used by another application

### Issue: Can't access reset-password screen
- **Solution**: Make sure the route exists in your app router
- Check `app/reset-password.tsx` exists

### Issue: Password update fails
- **Solution**: Check browser console or app logs for errors
- Verify you're clicking the reset link within the expiration time (usually 1 hour)

## Quick Test Checklist

- [ ] Can navigate to forgot password screen from login
- [ ] Can enter email and submit
- [ ] Success message appears after submission
- [ ] Email is received (check inbox/spam)
- [ ] Reset link in email is clickable
- [ ] Reset password screen loads correctly
- [ ] Can enter new password
- [ ] Password validation works
- [ ] Can successfully update password
- [ ] Can sign in with new password
- [ ] Old password no longer works

## Manual Testing (If Deep Links Don't Work)

If the email link doesn't automatically open your app, you can manually test:

1. **Copy the reset link from the email**
2. **Extract the tokens manually**:
   - The link will look like: `https://rvvujgbaswecqohixgog.supabase.co/auth/v1/verify?token=...&type=recovery&redirect_to=myapp://reset-password`
   - Click the link in a browser - it should redirect to `myapp://reset-password#access_token=...&refresh_token=...`
   - Copy the full redirected URL

3. **Test the deep link manually**:
   - On iOS Simulator: Open Safari and type the deep link URL
   - On Android Emulator: Use `adb shell am start -a android.intent.action.VIEW -d "myapp://reset-password#access_token=...&refresh_token=..."`
   - Or navigate directly in your app to `/reset-password` with the tokens as params

4. **Alternative: Use the web version**:
   - Temporarily change the redirect URL to a web URL
   - Test the reset flow in a web browser
   - Then switch back to deep links for mobile

## Need Help?

If you encounter issues:
1. Check the browser/app console for errors
2. Check Supabase dashboard logs
3. Verify your Supabase project email settings
4. Test deep links manually using the methods above
5. Ensure your app's URL scheme is properly configured in `app.json`

