import { corsForRequest } from '../_shared/cors.ts';
// @ts-ignore
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";



function genOtp(): string {
  const values = new Uint32Array(1);
  do { crypto.getRandomValues(values); } while (values[0] >= 4294800000);
  return String(100000 + values[0] % 900000);
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
        detail: undefined,
      };
      console.warn(`OTP email provider exception: ${providerName}`, lastResult.detail);
    }
  }

  return lastResult;
};

Deno.serve(async (req) => {
  const corsHeaders = corsForRequest(req);
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);
  try {
    const { email, type } = await req.json();
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || type !== 'signup') return respond({ error: 'Invalid request. Use Supabase recovery for password resets.' }, 400);
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new Error('Missing OTP server configuration');
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const { data: allowed, error: limitError } = await admin.rpc('allow_otp_request', { target_email: normalizedEmail, target_ip: ip });
    if (limitError) throw limitError;
    if (!allowed) return respond({ error: 'Please wait before requesting another code' }, 429);
    const user = await resolveUserByEmail(admin, normalizedEmail);
    // Same response whether an account exists or not. Never accept a caller-supplied UID.
    const accepted = { success: true, message: 'If the account can be verified, a code has been sent.' };
    if (!user) return respond(accepted);
    const code = genOtp();
    const { error: insertError } = await admin.rpc('issue_signup_otp', { target_email: normalizedEmail, target_user: user.id, target_code: code });
    if (insertError) throw insertError;
    const result = await sendOtpEmailWithFailover(normalizedEmail, 'Verify your email - 60Seconds', `Your verification code is: ${code}\nIt expires in 10 minutes.`);
    if (!result.ok) console.error('OTP delivery failed', result.provider);
    return respond(accepted);
  } catch (error) {
    console.error('OTP request failed', error);
    return respond({ success: false, error: 'Could not process request' }, 500);
  }
});
