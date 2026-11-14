# Deployment Checklist - PIN Verification & Password Reset Fixes

**Version**: 1.0
**Date**: 2026-06-25
**Priority**: HIGH (Critical signup and password reset flow fix)

## Pre-Deployment Verification

### Code Review Checklist
- [x] All edge functions reviewed for security
- [x] Error handling properly implemented
- [x] No hardcoded secrets or sensitive data
- [x] Backward compatibility maintained
- [x] Documentation updated
- [x] Memory notes updated

### Edge Functions to Deploy
```
✅ supabase/functions/send-otp/index.ts
   - Enhanced user resolution with try-catch
   - Better error handling for signup vs recovery
   - Fallback mechanisms improved

✅ supabase/functions/verify-otp/index.ts
   - Both paths set otp_verified: true
   - Welcome email sent non-blocking
   - Error handling for email send failures

✅ supabase/functions/create-signup-user/index.ts
   - otp_verified flag added
   - Cleaner metadata structure

✅ supabase/functions/update-password-by-uid/index.ts
   - Proper PIN validation and consumption
   - Better error messages
```

### Mobile App Files Modified
```
✅ app/signup.tsx - PIN retry logic (3 attempts)
✅ app/verify-otp.tsx - Enhanced error handling
✅ app/forgot-password.tsx - Better error messages
✅ app/reset-password.tsx - Improved validation
```

---

## Deployment Steps

### Step 1: Deploy Edge Functions to Staging

**Timing**: Should take 2-5 minutes per function

```bash
# Deploy each function
supabase functions deploy send-otp
supabase functions deploy verify-otp
supabase functions deploy create-signup-user
supabase functions deploy update-password-by-uid

# Verify deployment
curl https://YOUR-PROJECT.supabase.co/functions/v1/send-otp \
  -H "Authorization: Bearer YOUR-ANON-KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","type":"signup"}'
```

**Expected Response**:
```json
{
  "status": "ok",
  "function": "send-otp"
}
```

### Step 2: Test Staging Environment

**Duration**: 10-15 minutes

Test on Staging Devices:
- [ ] Create new account on iOS
  - [ ] Enter email/password/name
  - [ ] Receive PIN email
  - [ ] Enter PIN
  - [ ] Receive welcome email
  - [ ] Successfully sign in

- [ ] Create new account on Android
  - [ ] Same steps as iOS
  - [ ] Verify same behavior

- [ ] Test password reset on iOS
  - [ ] Click forgot password
  - [ ] Enter email
  - [ ] Receive recovery PIN
  - [ ] Enter PIN and new password
  - [ ] Sign in with new password

- [ ] Test password reset on Android
  - [ ] Same steps as iOS

### Step 3: Monitor Staging Logs

**Duration**: 5 minutes

In Supabase Dashboard:
1. Go to Functions
2. Click each function name
3. Check "Logs" tab for errors
4. Expected: No errors for test flow

Look for:
- ✅ "✅ PIN sent successfully"
- ✅ "✅ User found on page"
- ✅ "✅ Successfully found user"
- ⚠️ Any warnings (usually non-blocking)

### Step 4: Deploy to Production

**Timing**: Should take 2-5 minutes per function

```bash
# Set production environment
export SUPABASE_PROJECT_ID=YOUR_PROD_PROJECT_ID

# Deploy each function
supabase functions deploy send-otp --project-ref $SUPABASE_PROJECT_ID
supabase functions deploy verify-otp --project-ref $SUPABASE_PROJECT_ID
supabase functions deploy create-signup-user --project-ref $SUPABASE_PROJECT_ID
supabase functions deploy update-password-by-uid --project-ref $SUPABASE_PROJECT_ID
```

### Step 5: Deploy Mobile App

**Platforms**: iOS & Android

#### iOS (TestFlight)
1. Build app in Xcode
2. Archive and upload to App Store Connect
3. Submit for TestFlight review
4. Wait for approval (usually 30 minutes)
5. Post build notification to iOS test group

#### Android
1. Build app in Android Studio
2. Upload to Google Play Console internal testing
3. Assign build to internal testing group
4. Post build notification to Android test group

### Step 6: Initial Production Monitoring (24 hours)

**Duration**: Ongoing for 24 hours

Monitor Metrics:
- [ ] Signup success rate
- [ ] PIN delivery time
- [ ] Welcome email delivery
- [ ] Password reset success rate
- [ ] Error rates (should be < 1%)

**Supabase Dashboard Checks**:
1. Go to Auth → Users
   - [ ] New users appearing
   - [ ] Check signup_otp_verified in recent users

2. Go to Functions → Logs
   - [ ] send-otp: ✅ PIN sent successfully (no errors)
   - [ ] verify-otp: ✅ OTP verified (no errors)
   - [ ] send-welcome-email: Should see successful sends

3. Go to SQL Editor
   - Run: `SELECT COUNT(*) FROM otp_codes WHERE type='signup' AND expires_at > NOW();`
   - Expected: Should decrease over time as PINs are verified

4. Check Email Provider Dashboard
   - SendGrid/Postmark: PIN delivery rate should be > 95%

---

## Rollback Plan

If critical issues occur after deployment:

### Immediate Rollback (< 15 minutes)
1. In Supabase Dashboard → Functions
2. Click each function and use version selector
3. Revert to previous stable version
4. Test basic signup flow

### Mobile App Rollback (if needed)
1. Build previous stable app version
2. Deploy to TestFlight/internal testing
3. Notify users to update from store

### Data Cleanup (if needed)
```sql
-- Clean up orphaned OTP codes
DELETE FROM otp_codes 
WHERE expires_at < NOW() 
OR (type='recovery' AND created_at < NOW() - INTERVAL '1 day');

-- Reset test users (be careful with this)
-- Manual verification required
```

---

## Success Metrics

### After Deployment
- ✅ Signup completion rate: > 95%
- ✅ PIN delivery: < 2 seconds
- ✅ Welcome email delivery: > 99%
- ✅ Password reset success: > 98%
- ✅ Error rate: < 1%
- ✅ No regressions in other flows

### 24-Hour Check
- ✅ No critical errors in logs
- ✅ No user complaints
- ✅ Metrics stable
- ✅ Email provider showing high delivery rates

---

## Communication

### Before Deployment
Notify:
- [ ] Backend team lead
- [ ] QA team
- [ ] Customer support (if applicable)

Message: "Deploying PIN verification and password reset fixes. Testing on staging for 24 hours before production release."

### After Deployment
Update:
- [ ] Release notes document
- [ ] Internal wiki/documentation
- [ ] Slack/team channel

Message: "PIN verification and password reset flows updated. Enhanced reliability with retry logic and better error messages."

---

## Documentation References

- **Full Details**: [SIGNUP_PIN_VERIFICATION_FIXES.md](./SIGNUP_PIN_VERIFICATION_FIXES.md)
- **Quick Reference**: [PIN_VERIFICATION_QUICK_REF.md](./PIN_VERIFICATION_QUICK_REF.md)
- **Implementation**: [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)

---

## Contacts

**Backend Issues**: Check edge function logs in Supabase dashboard
**Mobile Issues**: Check React Native logs
**Email Issues**: Check SendGrid/Postmark dashboard

---

## Post-Deployment (1 Week)

- [ ] Review error logs for patterns
- [ ] Check user feedback for issues
- [ ] Verify all metrics remain stable
- [ ] Schedule code review with team
- [ ] Archive deployment documentation

---

**Status**: Ready to Deploy ✅
**Last Updated**: 2026-06-25
**Approved By**: [Needs sign-off]
