// @ts-ignore
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function genOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

type EmailSendResult = {
  ok: boolean;
  provider: "sendgrid" | "postmark" | "resend";
  detail?: string;
};

type AuthUserRecord = {
  id: string;
  email?: string | null;
};

const sendViaSendGrid = async (email: string, subject: string, text: string): Promise<EmailSendResult> => {
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
      content: [{ type: "text/plain", value: text }],
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    return { ok: false, provider: "sendgrid", detail: `status=${response.status}, body=${body}` };
  }

  return { ok: true, provider: "sendgrid", detail: body || "accepted" };
};

const sendViaPostmark = async (email: string, subject: string, text: string): Promise<EmailSendResult> => {
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
      TextBody: text,
      MessageStream: "outbound",
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    return { ok: false, provider: "postmark", detail: `status=${response.status}, body=${body}` };
  }

  return { ok: true, provider: "postmark", detail: body || "accepted" };
};

const sendViaResend = async (email: string, subject: string, text: string): Promise<EmailSendResult> => {
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
      text,
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    return { ok: false, provider: "resend", detail: `status=${response.status}, body=${body}` };
  }

  return { ok: true, provider: "resend", detail: body || "accepted" };
};

const resolveUserByEmail = async (supabase: ReturnType<typeof createClient>, normalizedEmail: string): Promise<AuthUserRecord | null> => {
  let page = 1;
  const perPage = 1000;

  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Failed to search users: ${error.message}`);
    }

    const users = data?.users || [];
    const matched = users.find((u: any) => String(u?.email || "").trim().toLowerCase() === normalizedEmail);
    if (matched) {
      return { id: matched.id, email: matched.email || null };
    }

    if (users.length < perPage) {
      break;
    }

    page += 1;
  }

  return null;
};

const resolveUserById = async (
  supabase: ReturnType<typeof createClient>,
  uid: string,
): Promise<AuthUserRecord | null> => {
  const { data, error } = await supabase.auth.admin.getUserById(uid);
  if (error) {
    throw new Error(`Failed to load user: ${error.message}`);
  }

  if (!data?.user) return null;
  return {
    id: data.user.id,
    email: data.user.email || null,
  };
};

const sendOtpEmailWithFailover = async (
  email: string,
  subject: string,
  text: string,
): Promise<EmailSendResult> => {
  // Prefer SendGrid first for signup PINs, then fall back if the SMTP provider is unavailable.
  const attempts = [sendViaSendGrid, sendViaPostmark, sendViaResend] as const;
  let lastResult: EmailSendResult = {
    ok: false,
    provider: "postmark",
    detail: "No provider attempted",
  };

  for (const providerSender of attempts) {
    try {
      const result = await providerSender(email, subject, text);
      if (result.ok) {
        return result;
      }

      lastResult = result;
      console.warn(`OTP email provider failed: ${result.provider}`, result.detail || "unknown reason");
    } catch (providerError: any) {
      const providerName =
        providerSender === sendViaPostmark
          ? "postmark"
          : providerSender === sendViaSendGrid
            ? "sendgrid"
            : "resend";

      lastResult = {
        ok: false,
        provider: providerName,
        detail: providerError?.message || String(providerError),
      };
      console.warn(`OTP email provider exception: ${providerName}`, lastResult.detail);
    }
  }

  return lastResult;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ status: "ok", function: "send-otp" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { email, type, user_id } = body;
    const normalizedEmail = typeof email === "string" ? email.replace(/\s+/g, "").trim().toLowerCase() : "";
    const t = type === "signup" || type === "recovery" ? type : null;

    if (!normalizedEmail || !t) {
      return new Response(
        JSON.stringify({ success: false, message: "email and type (signup|recovery) are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
// @ts-ignore
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ||
// @ts-ignore
      `https://${Deno.env.get("SUPABASE_PROJECT_REF") || "rvvujgbaswecqohixgog"}.supabase.co`;
// @ts-ignore
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceKey) {
      return new Response(
        JSON.stringify({ success: false, message: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let resolvedUser: AuthUserRecord | null = null;

    if (typeof user_id === "string" && user_id.trim()) {
      try {
        resolvedUser = await resolveUserById(supabase, user_id.trim());
      } catch (resolveErr) {
        console.warn("send-otp: resolveUserById failed, falling back to email lookup:", resolveErr);
      }

      if (!resolvedUser) {
        resolvedUser = await resolveUserByEmail(supabase, normalizedEmail);
      }

      if (!resolvedUser) {
        return new Response(
          JSON.stringify({ success: false, message: "No account found with this email" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const registeredEmail = String(resolvedUser.email || "").trim().toLowerCase();
      if (!registeredEmail || registeredEmail !== normalizedEmail) {
        return new Response(
          JSON.stringify({ success: false, message: "Reset PIN can only be sent to the registered email address" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      resolvedUser = await resolveUserByEmail(supabase, normalizedEmail);
      if (!resolvedUser) {
        return new Response(
          JSON.stringify({ success: false, message: "No account found with this email" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const uid = resolvedUser.id;

    const code = genOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase.from("otp_codes").delete().eq("email", normalizedEmail).eq("type", t);
    const { error: insErr } = await supabase.from("otp_codes").insert({
      email: normalizedEmail,
      code,
      type: t,
      user_id: uid,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    });
    if (insErr) {
      console.error("otp_codes insert error:", insErr);
      return new Response(
        JSON.stringify({ success: false, message: "Failed to save OTP" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isSignup = t === "signup";
    const subject = isSignup ? "Verify your email - 60Seconds" : "Reset your password - 60Seconds";
    const text = isSignup
      ? `Your 6-digit verification code is: ${code}\n\nIt expires in 10 minutes. Enter this code in the app to verify your email.\n\nIf you didn't sign up, ignore this email.`
      : `Your 6-digit password reset code is: ${code}\n\nIt expires in 10 minutes. Enter this code in the app to set a new password.\n\nIf you didn't request this, ignore this email.`;

    const sendResult = await sendOtpEmailWithFailover(normalizedEmail, subject, text);

    if (!sendResult.ok) {
      console.error("OTP email send failed:", sendResult.detail || "unknown error");
      return new Response(
        JSON.stringify({
          success: false,
          message: "Failed to send OTP email via configured providers",
          detail: sendResult.detail || null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Keep the latest OTP visible in Supabase Auth user metadata for support/debug workflows.
    try {
      const { data: authUserData, error: authUserErr } = await supabase.auth.admin.getUserById(uid);
      if (authUserErr) {
        console.warn("send-otp: failed to load user for metadata OTP stamp:", authUserErr.message);
      } else {
        const existingMeta = (authUserData?.user?.app_metadata || {}) as Record<string, unknown>;
        const stampedMeta: Record<string, unknown> = {
          ...existingMeta,
          latest_otp_code: code,
          latest_otp_type: t,
          latest_otp_email: normalizedEmail,
          latest_otp_expires_at: expiresAt,
          latest_otp_sent_at: new Date().toISOString(),
          latest_otp_provider: sendResult.provider,
        };

        if (t === "signup") {
          stampedMeta.signup_last_otp_code = code;
          stampedMeta.signup_last_otp_expires_at = expiresAt;
          stampedMeta.signup_last_otp_sent_at = stampedMeta.latest_otp_sent_at;
          stampedMeta.signup_last_otp_provider = sendResult.provider;
        }

        const { error: updateMetaErr } = await supabase.auth.admin.updateUserById(uid, {
          app_metadata: stampedMeta,
        });

        if (updateMetaErr) {
          console.warn("send-otp: failed to stamp OTP metadata:", updateMetaErr.message);
        }
      }
    } catch (metaStampErr) {
      console.warn("send-otp: unexpected metadata OTP stamp error:", metaStampErr);
    }

    return new Response(
      JSON.stringify({ success: true, message: "OTP sent", provider: sendResult.provider }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("send-otp error:", e);
    return new Response(
      JSON.stringify({ success: false, message: "An error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
