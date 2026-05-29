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
    const { uid, newPassword } = await req.json();

    if (!uid || !newPassword) {
      return new Response(
        JSON.stringify({ error: "UID and newPassword are required" }),
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

    console.log(`🔐 Updating password for user: ${uid}`);

    // Create admin client
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Update user password using Admin API
    console.log(`🔄 Calling Admin API to update password...`);
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(uid, {
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

    console.log(`✅ Password updated successfully for user: ${uid}`);
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Password updated successfully",
        userId: uid
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
