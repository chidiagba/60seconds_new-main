import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Function to fetch UID based on email
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse the email from the request body
    const { email } = await req.json().catch((err) => {
      console.error("Error parsing JSON:", err);
      return { email: "" };
    });

    // Check if email is valid
    if (!email || typeof email !== "string") {
      console.error("Invalid email provided:", email);
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    console.log(`🔍 Searching for user with email: ${normalizedEmail}`);

    // Get Supabase URL and Service Role Key from environment variables
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || 
      `https://${Deno.env.get("SUPABASE_PROJECT_REF") || "rvvujgbaswecqohixgog"}.supabase.co`;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("❌ Supabase URL or Service Role Key is missing");
      console.error("SUPABASE_URL:", !!supabaseUrl, "SERVICE_ROLE_KEY:", !!serviceRoleKey);
      return new Response(
        JSON.stringify({ error: "Server configuration error. Please check edge function secrets." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create the Supabase admin client using the Service Role Key
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Use Admin API listUsers with pagination to find the user
    // Search through multiple pages if needed
    let page = 1;
    const perPage = 1000;
    let found = null;
    let totalSearched = 0;

    console.log(`📋 Starting user search with Admin API...`);

    while (!found) {
      console.log(`📄 Searching page ${page} (perPage: ${perPage})...`);
      
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({
        page: page,
        perPage: perPage,
      });

      if (error) {
        console.error("❌ Error fetching users:", error);
        return new Response(
          JSON.stringify({ 
            error: error.message || "Failed to search for user",
            details: "Admin API error"
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (!data || !data.users) {
        console.error("❌ No users data returned");
        break;
      }

      totalSearched += data.users.length;
      console.log(`📊 Found ${data.users.length} users on page ${page} (total searched: ${totalSearched})`);

      // Find the user matching the provided email (case-insensitive)
      found = data.users.find((u) => {
        const userEmail = (u.email || "").toLowerCase().trim();
        return userEmail === normalizedEmail;
      });

      if (found) {
        console.log(`✅ User found on page ${page}!`);
        console.log(`   User ID: ${found.id}`);
        console.log(`   Email: ${found.email}`);
        break;
      }

      // If we got fewer users than perPage, we've reached the end
      if (data.users.length < perPage) {
        console.log(`📄 Reached end of users list. Total users searched: ${totalSearched}`);
        break;
      }

      page++;
      
      // Safety limit to prevent infinite loops (max 10 pages = 10,000 users)
      if (page > 10) {
        console.warn(`⚠️ Reached maximum page limit (10 pages = 10,000 users)`);
        break;
      }
    }

    if (!found) {
      console.error(`❌ No user found with email: ${normalizedEmail}`);
      console.error(`   Total users searched: ${totalSearched}`);
      return new Response(
        JSON.stringify({ 
          uid: null, 
          error: "No account found with this email address",
          searched: totalSearched
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const emailConfirmed = found.email_confirmed_at != null;
    const userMetadata = (found.user_metadata || {}) as Record<string, unknown>;
    const appMetadata = (found.app_metadata || {}) as Record<string, unknown>;
    const userType =
      (typeof userMetadata.user_type === "string" && userMetadata.user_type) ||
      (typeof appMetadata.user_type === "string" && appMetadata.user_type) ||
      null;
    const signupOtpVerifiedAt =
      typeof appMetadata.signup_otp_verified_at === "string"
        ? appMetadata.signup_otp_verified_at
        : null;
    const otpVerified = signupOtpVerifiedAt != null || userType === "private";

    // Return the UID of the found user
    console.log(`✅ Successfully found user: ${found.id}`);
    return new Response(
      JSON.stringify({ 
        uid: found.id, 
        success: true,
        email: found.email,
        email_confirmed: emailConfirmed,
        email_confirmed_at: found.email_confirmed_at ?? null,
        user_type: userType,
        otp_verified: otpVerified,
        signup_otp_verified_at: signupOtpVerifiedAt,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    console.error("❌ Server error:", e);
    const errorMessage = e instanceof Error ? e.message : "Server error";
    const errorStack = e instanceof Error ? e.stack : String(e);
    
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        details: errorStack
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
