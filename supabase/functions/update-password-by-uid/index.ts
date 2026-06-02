import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { uid, email, code, newPassword } = await req.json();
    const normalizedEmail = typeof email === "string" ? email.replace(/\s+/g, "").trim().toLowerCase() : "";
    const normalizedCode = typeof code === "string" ? code.replace(/\s+/g, "").trim() : "";

    if (!newPassword || (!uid && !(normalizedEmail && normalizedCode))) {
      return new Response(
        JSON.stringify({ error: "newPassword and either uid or email+code are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 8 characters" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get Supabase URL and Service Role Key from environment variables
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || 
      `https://${Deno.env.get("SUPABASE_PROJECT_REF") || "rvvujgbaswecqohixgog"}.supabase.co`;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("❌ Supabase configuration is missing");
      console.error("SUPABASE_URL:", !!supabaseUrl, "SERVICE_ROLE_KEY:", !!serviceRoleKey);
      return new Response(
        JSON.stringify({ error: "Server configuration error. Please check edge function secrets." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create admin client
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    let targetUid = typeof uid === "string" ? uid.trim() : "";

    if (!targetUid) {
      const now = new Date().toISOString();
      const { data: otpRows, error: otpLookupError } = await supabaseAdmin
        .from("otp_codes")
        .select("id, user_id")
        .eq("email", normalizedEmail)
        .eq("type", "recovery")
        .eq("code", normalizedCode)
        .gt("expires_at", now)
        .order("created_at", { ascending: false })
        .limit(1);

      if (otpLookupError) {
        console.error("❌ Error validating recovery code:", otpLookupError);
        return new Response(
          JSON.stringify({ error: "Failed to validate reset code" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const otpRow = otpRows?.[0];
      if (!otpRow?.user_id) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired reset code" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      targetUid = otpRow.user_id;
    }

    console.log(`🔐 Updating password for user: ${targetUid}`);

    // Update user password using Admin API
    console.log(`🔄 Calling Admin API to update password...`);
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(targetUid, {
      password: newPassword,
    });

    if (error) {
      console.error("❌ Error updating password:", error);
      return new Response(
        JSON.stringify({ 
          error: error.message || "Failed to update password",
          details: error
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (normalizedEmail && normalizedCode) {
      const { error: cleanupError } = await supabaseAdmin
        .from("otp_codes")
        .delete()
        .eq("email", normalizedEmail)
        .eq("type", "recovery")
        .eq("code", normalizedCode);

      if (cleanupError) {
        console.warn("⚠️ Password updated but failed to delete consumed recovery code:", cleanupError);
      }
    }

    console.log(`✅ Password updated successfully for user: ${targetUid}`);
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Password updated successfully",
        userId: targetUid
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in update-password-by-uid:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
