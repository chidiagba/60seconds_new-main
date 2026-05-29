import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ status: "ok", function: "verify-otp" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { email, code, type, user_id } = body;
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const requestType = typeof type === "string" ? type.trim() : "";
    const t = requestType === "signup" || requestType === "recovery" ? requestType : null;
    const c = typeof code === "string" ? code.trim() : "";

    // signup_email_otp is the new flow where Supabase auth.verifyOtp is done client-side.
    // This endpoint only stamps app_metadata after that verification.
    if (!normalizedEmail) {
      return new Response(
        JSON.stringify({ success: false, error: "email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ||
      `https://${Deno.env.get("SUPABASE_PROJECT_REF") || "rvvujgbaswecqohixgog"}.supabase.co`;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Supabase-only mode: client already verified OTP via supabase.auth.verifyOtp,
    // this endpoint only stamps app_metadata for signup gate completion.
    if (requestType === "signup_email_otp") {
      const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

      if (!token) {
        return new Response(
          JSON.stringify({ success: false, error: "Missing user session token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: tokenUserData, error: tokenUserErr } = await supabase.auth.getUser(token);
      if (tokenUserErr || !tokenUserData?.user) {
        return new Response(
          JSON.stringify({ success: false, error: "Invalid or expired session" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tokenUser = tokenUserData.user;
      const requestedUid = typeof user_id === "string" ? user_id.trim() : "";
      const effectiveUid = requestedUid || tokenUser.id;

      if (effectiveUid !== tokenUser.id) {
        return new Response(
          JSON.stringify({ success: false, error: "User mismatch" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (normalizedEmail && (tokenUser.email || "").toLowerCase() !== normalizedEmail) {
        return new Response(
          JSON.stringify({ success: false, error: "Email mismatch" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const existingMeta = (tokenUser.app_metadata || {}) as Record<string, unknown>;
      const otpVerifiedAt = new Date().toISOString();
      const { error: metaUpdateErr } = await supabase.auth.admin.updateUserById(tokenUser.id, {
        app_metadata: {
          ...existingMeta,
          signup_otp_verified_at: otpVerifiedAt,
          signup_otp_verified: true,
        },
      });

      if (metaUpdateErr) {
        return new Response(
          JSON.stringify({ success: false, error: `Failed to mark OTP as verified: ${metaUpdateErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const welcomeName = (tokenUser.email || normalizedEmail).split("@")[0] || "there";
      const { data: welcomeData, error: welcomeErr } = await supabase.functions.invoke("send-welcome-email", {
        body: {
          user_id: tokenUser.id,
          email: normalizedEmail,
          name: welcomeName,
          trigger: "post_signup_pin_verification_server",
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (welcomeErr) {
        return new Response(
          JSON.stringify({ success: false, error: `Welcome email failed: ${welcomeErr.message || "unknown error"}` }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!welcomeData?.success) {
        return new Response(
          JSON.stringify({ success: false, error: "Welcome email failed to send" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, uid: tokenUser.id, otp_verified: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!t || !c) {
      return new Response(
        JSON.stringify({ success: false, error: "code and type (signup|recovery) are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date().toISOString();
    const { data: rows, error: selErr } = await supabase
      .from("otp_codes")
      .select("id, user_id")
      .eq("email", normalizedEmail)
      .eq("type", t)
      .eq("code", c)
      .gt("expires_at", now)
      .limit(1);

    if (selErr || !rows?.length) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired OTP" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const row = rows[0];
    const uid = row?.user_id ?? null;

    if (t === "signup" && uid) {
      const { data: authUserData, error: authUserErr } = await supabase.auth.admin.getUserById(uid);
      if (authUserErr) {
        return new Response(
          JSON.stringify({ success: false, error: `Failed to load user: ${authUserErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const existingMeta = (authUserData?.user?.app_metadata || {}) as Record<string, unknown>;
      const otpVerifiedAt = new Date().toISOString();
      const { error: metaUpdateErr } = await supabase.auth.admin.updateUserById(uid, {
        app_metadata: {
          ...existingMeta,
          signup_otp_verified_at: otpVerifiedAt,
          signup_otp_verified: true,
        },
      });

      if (metaUpdateErr) {
        return new Response(
          JSON.stringify({ success: false, error: `Failed to mark OTP as verified: ${metaUpdateErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const authUserEmail = (authUserData?.user?.email || normalizedEmail).toLowerCase();
      const welcomeName = authUserEmail.split("@")[0] || "there";
      const { error: welcomeErr } = await supabase.functions.invoke("send-welcome-email", {
        body: {
          user_id: uid,
          email: authUserEmail,
          name: welcomeName,
          trigger: "post_signup_otp_table_verification_server",
        },
      });
      if (welcomeErr) {
        console.warn("send-welcome-email invocation failed (non-blocking):", welcomeErr);
      }
    }

    await supabase.from("otp_codes").delete().eq("id", row.id);

    return new Response(
      JSON.stringify({
        success: true,
        uid: uid || undefined,
        otp_verified: true,
        email_confirmation_required: t === "signup",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("verify-otp error:", e);
    return new Response(
      JSON.stringify({ success: false, error: "An error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
