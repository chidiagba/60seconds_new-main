// @ts-ignore
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AuthUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  app_metadata?: Record<string, unknown>;
};

const buildEmailContent = (name: string) => `Dear ${name},

I'm Coolman Chidiagba, Founder and CEO of 60seconds, and I'm excited to welcome you to our vibrant community! Thank you for registering with the 60seconds app. We're all about capturing those electrifying nightlife moments and making it easier for everyone to discover, share, and enjoy the best spots out there.

Our mission is to revolutionize how you experience nightlife through user-generated 60-second videos - helping party-goers find the hottest venues while empowering businesses to showcase their energy and attract crowds. Whether you're a private user looking for your next adventure or a business owner promoting your spot, we've got features designed to enhance your experience. Here's a rundown of what 60seconds offers:

For Private Users (Party-Goers):

* Discover Nightlife Spots: Browse a curated feed of 60-second videos showcasing bars, clubs, events, and hidden gems, all uploaded by fellow users to give you authentic vibes and insights.
* Rate and Recommend: Share your honest feedback by rating venues and recommending them to your network, helping others find spots that match their style while building a community of trusted reviews.
* Personalized Recommendations: Get tailored suggestions based on your preferences, location, and past interactions, making it simple to plan unforgettable nights out.
* Easy Sharing: Upload your own 60-second videos of epic moments, connect with like-minded party-goers, and follow trending events in real-time.
* User-Friendly Navigation: Search by location, vibe, or event type, with intuitive maps and filters to quickly find what's happening near you.

These features empower you to explore nightlife confidently, saving time and ensuring you never miss out on the action - all while contributing to a dynamic, user-driven platform.

For Business Users (Venue Owners and Promoters):

* Promote Your Spot: Upload engaging 60-second videos to highlight your venue's atmosphere, specials, events, and unique offerings, reaching a targeted audience of nightlife enthusiasts.
* Boost Visibility: Get featured in user searches and recommendations, with tools to track views, ratings, and engagement to refine your promotions.
* Ratings and Feedback: Collect authentic reviews and ratings from visitors, building credibility and using insights to improve your services and attract more customers.
* Event Promotion: Create and share video teasers for upcoming nights, products, or services, integrating with calendars and notifications to drive attendance.
* Analytics Dashboard: Access performance metrics like visitor trends and recommendation rates, helping you optimize marketing strategies and grow your business.

With these tools, businesses can turn passive promotion into active community engagement, increasing foot traffic and loyalty in a competitive nightlife scene.

Getting started is easy - download the app, upload your first video or start browsing, and catch the moment! If you have any questions or need tips on making the most of 60seconds, our support team is just a message away.

Welcome aboard, and let's make every night memorable!

Best regards,

Coolman Chidiagba
Founder & CEO
60seconds
Website: https://60secondsapp.io`;

const sendViaSendGrid = async (email: string, subject: string, emailContent: string): Promise<{ ok: boolean; provider: string; detail?: string }> => {
// @ts-ignore
  const SENDGRID_API_KEY = Deno.env.get("SENDGRID_API_KEY");
  if (!SENDGRID_API_KEY) {
    return { ok: false, provider: "sendgrid", detail: "SENDGRID_API_KEY missing" };
  }

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email }] }],
      from: { email: "support@60secondsapp.io", name: "Support 60Seconds" },
      subject,
      content: [{ type: "text/plain", value: emailContent }],
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      provider: "sendgrid",
      detail: `status=${response.status}, body=${text}`,
    };
  }

  return { ok: true, provider: "sendgrid", detail: text || "accepted" };
};

const findUserByEmail = async (admin: ReturnType<typeof createClient>, normalizedEmail: string): Promise<AuthUser | null> => {
  let page = 1;
  const perPage = 1000;

  while (page <= 10) {
    const { data, error } = await admin.auth.admin.listUsers({ page, per_page: perPage });
    if (error) {
      throw new Error(`Failed to search users: ${error.message}`);
    }

    const users = data?.users ?? [];
    const found = users.find((u) => (u.email || "").trim().toLowerCase() === normalizedEmail);
    if (found) {
      return found as AuthUser;
    }

    if (users.length < perPage) {
      break;
    }

    page += 1;
  }

  return null;
};

const sendViaPostmark = async (email: string, subject: string, emailContent: string): Promise<{ ok: boolean; provider: string; detail?: string }> => {
// @ts-ignore
  const POSTMARK_API_KEY = Deno.env.get("POSTMARK_API_KEY");
  if (!POSTMARK_API_KEY) {
    return { ok: false, provider: "postmark", detail: "POSTMARK_API_KEY missing" };
  }

  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "X-Postmark-Server-Token": POSTMARK_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      From: "Support 60Seconds <support@60secondsapp.io>",
      To: email,
      Subject: subject,
      TextBody: emailContent,
      MessageStream: "outbound",
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      provider: "postmark",
      detail: `status=${response.status}, body=${text}`,
    };
  }

  return { ok: true, provider: "postmark", detail: text };
};

const sendViaResend = async (email: string, subject: string, emailContent: string): Promise<{ ok: boolean; provider: string; detail?: string }> => {
// @ts-ignore
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    return { ok: false, provider: "resend", detail: "RESEND_API_KEY missing" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Support 60Seconds <support@60secondsapp.io>",
      to: email,
      subject,
      text: emailContent,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      provider: "resend",
      detail: `status=${response.status}, body=${text}`,
    };
  }

  return { ok: true, provider: "resend", detail: text };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const normalizedEmail = String(body?.email || "").trim().toLowerCase();
    const name = String(body?.name || "").trim();
    const userId = String(body?.user_id || "").trim();
    const trigger = String(body?.trigger || "").trim();

    if (!normalizedEmail || !name) {
      return new Response(
        JSON.stringify({ success: false, message: "email and name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

// @ts-ignore
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ||
// @ts-ignore
      `https://${Deno.env.get("SUPABASE_PROJECT_REF") || ""}.supabase.co`;
// @ts-ignore
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ success: false, message: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let authUser: AuthUser | null = null;

    if (userId) {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error) {
        return new Response(
          JSON.stringify({ success: false, message: `Failed to read user: ${error.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      authUser = (data?.user as AuthUser | null) ?? null;
    } else {
      authUser = await findUserByEmail(admin, normalizedEmail);
    }

    if (!authUser) {
      return new Response(
        JSON.stringify({ success: false, message: "User not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const existingMeta = (authUser.app_metadata || {}) as Record<string, unknown>;
    const signupOtpVerifiedAt =
      typeof existingMeta.signup_otp_verified_at === "string"
        ? existingMeta.signup_otp_verified_at
        : null;
    const canBypassOtpGuard =
      trigger === "post_signup_pin_verification_server" ||
      trigger === "post_signup_otp_table_verification_server";

    if (!signupOtpVerifiedAt && !canBypassOtpGuard) {
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "signup_otp_not_verified" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Primary guard: check profiles table (reliable, never silently fails).
    const { data: profileRow, error: profileReadErr } = await admin
      .from("profiles")
      .select("welcome_email_sent_at")
      .eq("id", authUser.id)
      .maybeSingle();

    if (profileReadErr) {
      console.warn("Could not read profile for welcome-email guard:", profileReadErr.message);
    }

    if (profileRow?.welcome_email_sent_at) {
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "already_sent" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Secondary guard: app_metadata (fast path if profiles check above somehow missed).
    if (existingMeta.ceo_welcome_email_sent_at) {
      // Back-fill the profiles column so the primary guard works from now on.
      await admin
        .from("profiles")
        .update({ welcome_email_sent_at: existingMeta.ceo_welcome_email_sent_at })
        .eq("id", authUser.id);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "already_sent" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const subject = "Welcome to 60seconds - Catch The Moment!";
    const emailContent = buildEmailContent(name);

    // Priority order:
    // 1) SendGrid (SMTP provider configured in Supabase Auth)
    // 2) Postmark
    // 3) Resend
    let sendResult = await sendViaSendGrid(normalizedEmail, subject, emailContent);
    if (!sendResult.ok) {
      sendResult = await sendViaPostmark(normalizedEmail, subject, emailContent);
    }
    if (!sendResult.ok) {
      sendResult = await sendViaResend(normalizedEmail, subject, emailContent);
    }

    if (!sendResult.ok) {
      console.error("send-welcome-email failed:", sendResult.detail || "unknown error");
      return new Response(
        JSON.stringify({
          success: false,
          message: "Failed to send email through configured providers",
          detail: sendResult.detail || null,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sentAt = new Date().toISOString();

    // Stamp the profiles table first — this is the primary deduplication guard.
    const { error: profileUpdateErr } = await admin
      .from("profiles")
      .update({ welcome_email_sent_at: sentAt })
      .eq("id", authUser.id);

    if (profileUpdateErr) {
      console.warn("Welcome email sent but failed to stamp profiles.welcome_email_sent_at:", profileUpdateErr.message);
    }

    // Also stamp app_metadata as a secondary record.
    const stampedMeta = {
      ...existingMeta,
      ceo_welcome_email_sent_at: sentAt,
      ceo_welcome_email_provider: sendResult.provider,
    };
    const { error: updateErr } = await admin.auth.admin.updateUserById(authUser.id, {
      app_metadata: stampedMeta,
    });
    if (updateErr) {
      console.warn("Welcome email sent but failed to stamp app_metadata:", updateErr.message);
    }

    return new Response(
      JSON.stringify({ success: true, provider: sendResult.provider, sent_once: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("send-welcome-email error:", message);
    return new Response(
      JSON.stringify({ success: false, message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
