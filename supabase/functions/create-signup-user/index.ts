import { corsForRequest } from '../_shared/cors.ts';
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";



type SignupBody = {
  email?: string;
  password?: string;
  profileData?: {
    full_name?: string;
    username?: string;
    user_type?: "business" | "private";
    business_name?: string;
    business_type?: string;
    country?: string;
    country_code?: string;
    currency?: string;
  };
  attribution?: {
    referral_code?: string;
    source?: string;
    platform?: string;
    first_open_at?: string;
  };
};

const resolveSignupCurrency = (profileData: SignupBody['profileData']): string => {
  const explicitCurrency = String(profileData?.currency || '').trim().toUpperCase();
  if (explicitCurrency) {
    return explicitCurrency;
  }

  const countryCode = String(profileData?.country_code || '').trim().toUpperCase();
  const country = String(profileData?.country || '').trim().toLowerCase();

  // Keep explicit NGN default for Nigerian signups.
  if (countryCode === 'NG' || country === 'nigeria') {
    return 'NGN';
  }

  return 'USD';
};

Deno.serve(async (req) => {
  const corsHeaders = corsForRequest(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as SignupBody;
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");
    const profileData = body?.profileData || {};
    const referralCode = String(body?.attribution?.referral_code || '').trim().toLowerCase();
    if (referralCode && !/^[a-z0-9][a-z0-9_-]{2,39}$/.test(referralCode)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid referral code' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!email || !password) {
      return new Response(JSON.stringify({ success: false, error: "email and password are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL") ||
      `https://${Deno.env.get("SUPABASE_PROJECT_REF") || "rvvujgbaswecqohixgog"}.supabase.co`;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ success: false, error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let validatedCampaign: { campaign_id: string; referral_code: string } | null = null;
    if (referralCode) {
      const { data: campaign, error: campaignError } = await admin
        .from('influencer_campaigns')
        .select('campaign_id,referral_code')
        .eq('referral_code', referralCode)
        .eq('active', true)
        .maybeSingle();
      if (campaignError) {
        console.error('Campaign validation unavailable:', campaignError.code || 'database_error');
        return new Response(JSON.stringify({ success: false, error: 'Referral validation is temporarily unavailable' }), {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!campaign) {
        return new Response(JSON.stringify({ success: false, error: 'Referral code is not recognized' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      validatedCampaign = campaign;
    }
    const allowedSources = ['android_install_referrer', 'ios_deferred_deeplink', 'direct_deeplink', 'manual_code', 'organic'];
    const attributionSource = allowedSources.includes(String(body?.attribution?.source || ''))
      ? String(body?.attribution?.source)
      : 'manual_code';
    const requestedPlatform = String(body?.attribution?.platform || '').toLowerCase();
    const attributionPlatform = ['android', 'ios', 'web'].includes(requestedPlatform) ? requestedPlatform : 'unknown';
    const firstOpenCandidate = body?.attribution?.first_open_at;
    const firstOpenDate = typeof firstOpenCandidate === 'string' ? new Date(firstOpenCandidate) : null;
    const firstOpenAt = firstOpenDate && !Number.isNaN(firstOpenDate.getTime()) ? firstOpenDate.toISOString() : null;

    const { data: staleProfile } = await admin
      .from('profiles')
      .select('id,email,username,full_name')
      .eq('email', email)
      .maybeSingle();

    if (staleProfile) {
      let authUserExists = false;
      let page = 1;
      const perPage = 1000;

      while (!authUserExists && page <= 10) {
        const { data, error } = await admin.auth.admin.listUsers({ page, per_page: perPage });
        if (error) {
          return new Response(JSON.stringify({ success: false, error: 'Request could not be completed' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        authUserExists = Boolean(data?.users?.find((u) => (u.email || '').trim().toLowerCase() === email));

        if (!data?.users?.length || data.users.length < perPage) {
          break;
        }

        page += 1;
      }

      if (!authUserExists) {
        const { error: deleteErr } = await admin.from('profiles').delete().eq('email', email);
        if (deleteErr) {
          return new Response(JSON.stringify({ success: false, error: 'Request could not be completed' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else {
        return new Response(
          JSON.stringify({ success: false, code: 'existing_user', error: 'User already exists' }),
          {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    let existingUserId: string | null = null;
    let page = 1;
    const perPage = 1000;

    while (!existingUserId && page <= 10) {
      const { data, error } = await admin.auth.admin.listUsers({ page, per_page: perPage });
      if (error) {
        return new Response(JSON.stringify({ success: false, error: 'Request could not be completed' }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const match = data?.users?.find((u) => (u.email || "").trim().toLowerCase() === email);
      if (match) {
        existingUserId = match.id;
        break;
      }

      if (!data?.users?.length || data.users.length < perPage) {
        break;
      }

      page += 1;
    }

    if (existingUserId) {
      return new Response(
        JSON.stringify({ success: false, code: "existing_user", error: "User already exists" }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const isBusinessSignup = profileData.user_type === "business";
    const otpVerifiedAt = isBusinessSignup ? null : new Date().toISOString();

    const userMetadata = {
      full_name: profileData.full_name,
      username: profileData.username,
      user_type: profileData.user_type,
      business_name: profileData.business_name,
      business_type: profileData.business_type,
      country: profileData.country,
      country_code: profileData.country_code,
      currency: resolveSignupCurrency(profileData),
    };

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        ...userMetadata,
        signup_otp_verified_at: otpVerifiedAt,
        ...(validatedCampaign ? {
          campaign_attribution: {
            referral_code: validatedCampaign.referral_code,
            source: attributionSource,
            platform: attributionPlatform,
            first_open_at: firstOpenAt,
          },
        } : {}),
      },
      app_metadata: {
        signup_otp_verified: !isBusinessSignup,
        otp_verified: !isBusinessSignup,
        signup_otp_verified_at: otpVerifiedAt,
        user_type: profileData.user_type,
      },
    });

    if (createErr || !created?.user?.id) {
      return new Response(JSON.stringify({ success: false, error: 'Request could not be completed' }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const createdUserId = created.user.id;
    if (validatedCampaign) {
      const { error: attributionError } = await admin.rpc('attach_campaign_attribution', {
        p_user_id: createdUserId,
        p_referral_code: referralCode,
        p_source: attributionSource,
        p_platform: attributionPlatform,
        p_first_open_at: firstOpenAt,
      });
      if (attributionError) {
        console.error('Campaign attribution attachment failed:', attributionError.code || 'database_error');
      }
    }

    let welcomeEmailTriggered = false;
    if (!isBusinessSignup) {
      const fallbackName =
        String(profileData.full_name || "").trim() ||
        String(email.split("@")[0] || "there").trim() ||
        "there";

      try {
        const { data: welcomeData, error: welcomeErr } = await admin.functions.invoke("send-welcome-email", {
          body: {
            user_id: createdUserId,
            email,
            name: fallbackName,
            trigger: "post_private_signup_autoverified",
          },
        });

        if (!welcomeErr && welcomeData?.success) {
          welcomeEmailTriggered = true;
        }
      } catch (welcomeInvokeErr) {
        console.warn("Failed to trigger welcome email for private signup (non-blocking):", welcomeInvokeErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: createdUserId,
        email,
        user_type: profileData.user_type,
        needs_verification: isBusinessSignup,
        otp_verified: !isBusinessSignup,
        welcome_email_triggered: welcomeEmailTriggered,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "An error occurred";
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
