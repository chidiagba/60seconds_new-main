import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsForRequest } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const corsHeaders = corsForRequest(req);
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);
  try {
    const { email, code, type, referral_code: referralCodeInput } = await req.json();
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new Error('Missing OTP server configuration');
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    let uid: string | null = null;
    if (type === 'signup_email_otp') {
      const token = req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
      if (!token) return respond({ error: 'Sign in required' }, 401);
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data.user || data.user.email?.toLowerCase() !== normalizedEmail) return respond({ error: 'Invalid session' }, 401);
      // getUser verified the token; require OTP authentication, not just a password session.
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (!payload.amr?.some((entry: { method: string }) => entry.method === 'otp')) return respond({ error: 'Email verification required' }, 403);
      uid = data.user.id;
    } else if (type === 'signup' && typeof code === 'string' && /^\d{6}$/.test(code)) {
      const { data, error } = await admin.rpc('consume_signup_otp', { target_email: normalizedEmail, target_code: code });
      if (error) throw error;
      uid = data;
    }
    if (!uid) return respond({ success: false, error: 'Invalid or expired code' }, 400);
    const { data: userData, error: userError } = await admin.auth.admin.getUserById(uid);
    if (userError) throw userError;
    const { error: updateError } = await admin.auth.admin.updateUserById(uid, {
      app_metadata: { ...userData.user.app_metadata, signup_otp_verified_at: new Date().toISOString(), signup_otp_verified: true, otp_verified: true },
    });
    if (updateError) throw updateError;
    const referralCode = typeof referralCodeInput === 'string' ? referralCodeInput.trim().toLowerCase() : '';
    if (referralCode && /^[a-z0-9][a-z0-9_-]{2,39}$/.test(referralCode)) {
      const { error: attributionError } = await admin.rpc('attach_campaign_attribution', {
        p_user_id: uid,
        p_referral_code: referralCode,
        p_source: 'manual_code',
        p_platform: 'unknown',
        p_first_open_at: null,
      });
      if (attributionError) console.error('Campaign attribution recovery failed:', attributionError.code || 'database_error');
    }
    // Trusted server invocation; endpoint resolves the email from this verified identity.
    const {error:welcomeError}=await admin.functions.invoke('send-welcome-email',{body:{user_id:uid}});
    if(welcomeError) console.error('Welcome email delivery deferred');
    return respond({ success: true, otp_verified: true });
  } catch (error) {
    console.error('OTP verification failed', error);
    return respond({ success: false, error: 'Could not verify code' }, 500);
  }
});
