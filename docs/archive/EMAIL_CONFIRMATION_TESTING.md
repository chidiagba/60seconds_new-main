# Email Confirmation System - Testing & Troubleshooting Guide

## ✅ DIAGNOSTIC CHECKLIST

### Phase 1: Configuration Verification

#### Supabase Settings
```bash
# Check in Supabase Dashboard:
1. Project Settings → Auth
   □ Email Provider: Configured? 
   □ Default sender: Set? (e.g., noreply@supabase.com)
   □ SMTP: Configured or using default?

2. Authentication → Providers → Email
   □ Enable sign up: enabled ✓
   □ Require email confirmation: ENABLED ✓
   □ Email templates: Available?

3. Email Templates
   □ Confirm signup: exists?
   □ Email change: exists?
   □ Magic link: exists?
```

#### App Configuration
```bash
# Check in app.json:
□ "scheme": "myapp" is defined
□ Scheme is unique (not generic)
□ Deep link path: /email-confirmed

# Check in .env file:
□ EXPO_PUBLIC_EMAIL_CONFIRM_REDIRECT_URL not needed (uses default)
□ Or explicitly set to: myapp://email-confirmed
```

#### Code Configuration
```bash
# Check in supabase/config.toml:
[auth.email]
□ enable_confirmations = true     ← CRITICAL
□ enable_signup = true
□ double_confirm_changes = true
□ max_frequency = "1s"

[auth.sms]
□ enable_confirmations = false    ← Should be false for email only
```

---

### Phase 2: Code Implementation Verification

Run these checks in your codebase:

#### lib/auth.tsx
```bash
✓ signUp() function:
  □ Accepts options parameter
  □ Passes emailRedirectTo in options
  □ Returns needsVerification: !data.user?.email_confirmed_at
  □ Calls signOut() if email_confirmed_at is null

✓ checkEmailVerification() function:
  □ Returns user?.email_confirmed_at != null
```

#### app/signup.tsx
```bash
✓ handleSignUp() function:
  □ Calls supabaseSignUp(email, password, profileData, { emailRedirectTo })
  □ Checks signUpResult.needsVerification
  □ Routes to /verify-otp if true
  □ Routes to /signin if false
```

#### app/signin.tsx
```bash
✓ handleSignin() function:
  □ Calls get-uid-by-email edge function
  □ Checks verificationData?.email_confirmed === false
  □ Shows error if email not confirmed
  □ Calls signInWithPassword()
  □ Checks authData.user.email_confirmed_at
  □ Calls signOut() if not confirmed
  □ Shows error to user
```

#### app/email-confirmed.tsx
```bash
✓ EmailConfirmedScreen component:
  □ Displays confirmation message
  □ Button to route to /signin
  □ Calls signOut() on mount
```

#### app/verify-otp.tsx
```bash
✓ VerifyOTPScreen component:
  □ Shows OTP entry field
  □ Text says: "confirm your email from the confirmation email"
  □ Calls verify-otp edge function
  □ Shows success message with note about email confirmation
```

---

### Phase 3: Edge Function Verification

#### supabase/functions/get-uid-by-email
```bash
✓ Function logic:
  □ Receives email in body
  □ Queries auth.users by email
  □ Returns: uid, email_confirmed status
  □ Checks: email_confirmed_at != null
  □ Returns: email_confirmed = true/false
```

#### supabase/functions/verify-otp
```bash
✓ Function logic:
  □ Does NOT set email_confirm = true
  □ Does NOT update email_confirmed_at
  □ Only validates OTP code
  □ Deletes OTP after verification
  □ Returns: otp_verified = true, email_confirmation_required = true
```

---

## 🧪 TESTING PROCEDURES

### Test Case 1: Basic Signup to Email Confirmation

**Prerequisite:** Access to a test email inbox (Gmail, temporary email, etc.)

**Steps:**
```
1. Open app on iOS/Android simulator
2. Navigate to /signup
3. Select account type: "Personal"
4. Fill in:
   - Name: "Test User"
   - Username: "testuser123"
   - Email: test.email@gmail.com  ← Use accessible email
   - Password: Test@12345
5. Click "Sign Up" button
6. EXPECT: Route to /verify-otp screen
7. CHECK: Email inbox for:
   - Confirmation email from Supabase
   - OTP email with 6-digit code
8. Click confirmation link in email
9. EXPECT: App opens /email-confirmed screen
10. VERIFY: Message says "Email Confirmed"
11. Click "Go To Sign In"
12. EXPECT: Navigate to /signin
13. Enter email + password
14. EXPECT: Login succeeds
15. VERIFY: Routed to home screen ✅
```

**Success Criteria:**
- ✅ Two emails received (confirmation + OTP)
- ✅ Confirmation link works (deep link)
- ✅ Email confirmed screen shows
- ✅ Login succeeds after confirmation

---

### Test Case 2: Login Blocked Without Email Confirmation

**Prerequisite:** Unconfirmed email account

**Steps:**
```
1. Create signup but DO NOT click confirmation link
2. Go to /signin
3. Enter email + password from signup
4. Click "Sign In" button
5. EXPECT: Error message appears
6. VERIFY: Error says "confirm your email"
7. CHECK: Red inline error (not Alert dialog)
8. TRY AGAIN: Still blocked ✓
9. Go back and click confirmation link
10. Enter email + password again
11. EXPECT: Login succeeds ✅
```

**Success Criteria:**
- ✅ Error message prevents login
- ✅ Clear error text
- ✅ User knows to check email
- ✅ Works after confirmation

---

### Test Case 3: OTP Verification (Separate)

**Prerequisite:** In /verify-otp screen after signup

**Steps:**
```
1. App shows /verify-otp
2. Message: "We sent OTP and confirmation email"
3. Check email for OTP code: 123456
4. Type code in [_ _ _ _ _ _] field
5. Click "Verify OTP" button
6. EXPECT: Success message appears
7. VERIFY: Text mentions "email confirmation still required"
8. IMPORTANT: Do NOT yet click confirmation link
9. Click "Continue to Sign In"
10. EXPECT: Route to /signin
11. Try to login
12. EXPECT: Blocked with "confirm your email"
13. Now click confirmation link in email
14. Login again
15. EXPECT: Succeeds ✅
```

**Success Criteria:**
- ✅ OTP verified successfully
- ✅ Message about email confirmation requirement
- ✅ Still blocked from login without email confirmation
- ✅ Email confirmation path works

---

### Test Case 4: Deep Link Handling

**Prerequisite:** Confirmation email received

**Steps:**
```
1. Check email inbox
2. Find email from noreply@supabase.com
3. Subject: "Confirm your email" or similar
4. Copy confirmation link
5. Example: https://...supabase.co/auth/v1/callback?token=abc123...
6. OR custom: myapp://email-confirmed?token=abc123
7. Tap link in email
8. EXPECT: Deep link opens app
9. VERIFY: Routes to /email-confirmed
10. CHECK: Page shows confirmation message
11. Button: "Go To Sign In"
12. Click button
13. EXPECT: Navigate to /signin ✅
```

**Success Criteria:**
- ✅ Deep link recognized
- ✅ App opens correctly
- ✅ Routes to /email-confirmed
- ✅ Confirmation is processed

---

### Test Case 5: Business Account Signup

**Steps:**
```
1. Navigate to /signup
2. Select: "Business" account type
3. Fill in:
   - Name: "Business Owner"
   - Business Name: "Test Bar"
   - Business Type: "Bar"
   - Email: test.business@gmail.com
   - Password: Test@12345
   - Country: Select from dropdown
4. Click "Sign Up"
5. EXPECT: Route to /verify-otp
6. EXPECT: Emails received
7. Follow email confirmation flow
8. After login
9. EXPECT: Routes to /(tabsbusiness) ✅
```

**Success Criteria:**
- ✅ Same email confirmation flow
- ✅ OTP still sent
- ✅ Routes to business tabs after login
- ✅ No difference in verification process

---

### Test Case 6: Multiple Attempts

**Steps:**
```
1. Create account 1: test1@example.com
2. Route to /verify-otp
3. Create account 2: test1@example.com (SAME EMAIL)
4. EXPECT: Error "User already exists"
5. OR: Both accounts created separately?
6. Try login with test1@example.com
7. EXPECT: Blocked (one not confirmed)
8. Confirm email for test1
9. EXPECT: Can login
10. Sign out
11. Create account 3: test2@example.com
12. Confirm this email
13. Login with test2@example.com
14. EXPECT: Succeeds ✅
```

**Success Criteria:**
- ✅ Duplicate email handling correct
- ✅ First account blocks login
- ✅ After confirmation, can login
- ✅ Multiple accounts work correctly

---

## 🔍 TROUBLESHOOTING

### Issue 1: Confirmation Email Not Received

**Diagnosis:**
```bash
1. Check spam/junk folder
2. Check promotions tab (Gmail)
3. Check different email client
4. Verify email address spelled correctly
```

**Solutions:**
```bash
□ Step 1: Verify Supabase Email Provider
  - Go to Supabase Dashboard
  - Check: Auth → Email → Provider
  - Ensure: Configured (not using Postmark if no API key)
  
□ Step 2: Check Email Logs
  - Supabase Dashboard → Auth → Logs
  - Search for email address
  - Look for "email_change" or "confirmation" events
  - Check if sent or failed
  
□ Step 3: Verify Sender Address
  - Check email from address
  - Should be from Supabase domain or custom SMTP
  - Not from random domain
  
□ Step 4: Test with Different Email
  - Use Gmail, Hotmail, Yahoo
  - Try temporary email (tempmail.com)
  - See if pattern shows issue

□ Step 5: Check Project Environment
  - Might be on staging/development email
  - Verify production Supabase URL used
```

**If Still Not Received:**
```bash
1. Check Supabase project logs
2. Verify auth.email settings in config.toml
3. Restart Supabase (in local dev): supabase stop && supabase start
4. Check if SMTP credentials valid
5. Look for error messages in logs
```

---

### Issue 2: App Doesn't Open on Confirmation Link

**Diagnosis:**
```bash
1. Deep link might not be registered
2. Scheme might not match
3. Deep link handler missing
```

**Solutions:**
```bash
□ Step 1: Verify Scheme in app.json
  "scheme": "myapp"
  Should NOT be "https" or generic
  
□ Step 2: Rebuild App
  npm run android  # or ios
  Deep link changes require rebuild
  
□ Step 3: Verify Deep Link Path
  Expected: myapp://email-confirmed
  Check if /email-confirmed route exists
  
□ Step 4: Test Deep Link Manually
  - In terminal, run:
    adb shell am start -W -a android.intent.action.VIEW -d "myapp://email-confirmed" com.example.app
  - Or iOS equivalent
  - Should open app to /email-confirmed
  
□ Step 5: Check Expo Router Config
  - Verify email-confirmed.tsx exists
  - Verify route is registered
  - Check _layout.tsx includes this route

□ Step 6: Alternative: Use Supabase Redirect
  - Instead of myapp://email-confirmed
  - Use: https://yourapp.com/auth/callback
  - Then handle redirect in web/Next.js
```

---

### Issue 3: Login Blocked Even After Email Confirmed

**Diagnosis:**
```bash
1. email_confirmed_at might not be set
2. Signin check might be broken
3. Session cache issue
```

**Solutions:**
```bash
□ Step 1: Verify in Supabase Dashboard
  1. Go to Auth Users
  2. Find user email
  3. Check "Email Confirmed At" field
  4. Should show timestamp, not NULL
  
□ Step 2: Check signin.tsx Code
  - Find the email_confirmed_at check
  - Verify it exists
  - Verify condition is correct
  
□ Step 3: Refresh App
  - Force close app
  - Clear app data/cache
  - Reopen and try again
  
□ Step 4: Check get-uid-by-email Edge Function
  - Verify it returns email_confirmed correctly
  - Test manually in Supabase dashboard
  - Check if query is correct
  
□ Step 5: Verify Session State
  - useAuth should have loaded confirmed user
  - Check AuthProvider initialization
  - Might need to restart app
```

---

### Issue 4: OTP Not Received

**Diagnosis:**
```bash
1. OTP sent but to wrong email
2. Email filtering/spam issue
3. Edge function failed
```

**Solutions:**
```bash
□ Step 1: Check OTP Code in Database
  - Supabase: Open SQL Editor
  - Run: SELECT * FROM otp_codes WHERE email = 'your@email.com'
  - Should see recent record
  - Check expires_at is in future
  
□ Step 2: Verify Edge Function
  - Check supabase/functions/send-otp/index.ts
  - Run: supabase functions list
  - Verify send-otp is deployed
  
□ Step 3: Check Email Logs
  - Might be sent to Postmark
  - Check Postmark dashboard
  - Verify email address correct
  
□ Step 4: Resend OTP
  - If button available on /verify-otp
  - Or create new account
  
□ Step 5: Manual OTP Entry
  - If have access to DB
  - Create OTP code manually
  - Or use test OTP from config
```

---

### Issue 5: Users Can Login Without Email Confirmation

**Diagnosis:**
```bash
1. Email confirmation check missing
2. Confirmation requirement disabled
3. Bug in signin logic
```

**Solutions:**
```bash
□ Step 1: Check config.toml
  [auth.email]
  enable_confirmations = true  ← MUST be true
  
□ Step 2: Check signin.tsx
  - Find email_confirmed_at check
  - Verify it's NOT commented out
  - Verify logic is correct
  
□ Step 3: Check get-uid-by-email function
  - Verify it's called
  - Verify response is used
  
□ Step 4: Rebuild and Clear Cache
  - npm run android (forces rebuild)
  - Clear app data completely
  
□ Step 5: Check Database Directly
  - Supabase → Auth Users
  - Manual check: email_confirmed_at NULL or set?
  - Should be NULL for unconfirmed

□ Step 6: Add Logging
  - Add console.log before signin attempt
  - Log: emailConfirmed value
  - Log: What signin.tsx receives
```

---

## 🚀 TESTING WORKFLOW

### For Local Development

```bash
# 1. Start with clean state
npm run android

# 2. Test signup
- Create account
- Check for email
- Note: May take 30 seconds

# 3. Test email link
- Click confirmation link
- Should open app
- Should show confirmation page

# 4. Test login
- Sign out
- Try login
- Should work now

# 5. Test OTP (optional)
- Create new account
- Go to verify-otp
- Enter OTP from email
- Verify message shows

# 6. Repeat with different email types
- Gmail, Hotmail, Yahoo, etc.
```

### For Staging/Production

```bash
# 1. Deploy code
git push origin main

# 2. Build APK/IPA
eas build --platform android --profile staging

# 3. Install on device

# 4. Full end-to-end test
- Create account with real email
- Check inbox
- Click confirmation link
- Login
- Verify in Supabase dashboard

# 5. Monitor logs
- Supabase Dashboard → Logs
- Look for auth events
- Check for errors
```

---

## 📊 MONITORING DASHBOARD

### Supabase Dashboard Checks

```
1. Auth → Users
   □ User created? 
   □ Email address correct?
   □ Email Confirmed At set?
   □ Last Sign In shows?

2. Auth → Logs
   □ signup event appears?
   □ email_confirmation_challenge appears?
   □ authenticated event appears?
   □ Errors visible?

3. Email → Settings
   □ Provider configured?
   □ Rate limits OK?
   □ SMTP working?

4. Database → auth.users
   SQL Query:
   SELECT id, email, email_confirmed_at, created_at
   WHERE created_at > now() - interval '1 hour'
```

---

## ✨ SUCCESS CRITERIA

Your email confirmation is working correctly when:

✅ **Signup:**
- Account created
- needsVerification returns true
- Routed to /verify-otp

✅ **Email:**
- Confirmation email received
- OTP email received
- Both arrive within 1 minute

✅ **Confirmation:**
- Click link → app opens
- /email-confirmed screen shows
- "Go To Sign In" button works

✅ **Login:**
- Without confirmation → Blocked
- After confirmation → Succeeds
- email_confirmed_at set in database

✅ **Subsequent Logins:**
- Can login anytime
- No re-confirmation needed
- Session managed correctly

---

Everything is ready! Just test the flow above and you're good to go. 🎉
