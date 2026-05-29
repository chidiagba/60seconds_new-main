// Supabase Edge Function for Sending Password Reset Emails via Postmark
// This function sends password reset emails using Postmark (fast) instead of Supabase's slow email service

// @ts-ignore - Deno is available in Supabase Edge Functions runtime
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Log that function was called - THIS SHOULD APPEAR IN LOGS IF FUNCTION IS ACCESSIBLE
  console.log("🚀 send-password-reset function called");
  console.log("📋 Request method:", req.method);
  console.log("📋 Request URL:", req.url);
  
  // Health check endpoint - helps verify function is deployed
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ 
        status: "ok", 
        function: "send-password-reset",
        message: "Function is deployed and accessible"
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    console.log("✅ CORS preflight request handled");
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("📧 Starting password reset email process...");
    // Parse request body
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Invalid JSON in request body",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { email, redirect_to } = body;

    // Validate input
    if (!email) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Email is required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get Supabase credentials
    // In Edge Functions, SUPABASE_URL is automatically available
    // If not available, construct from project reference
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || 
      `https://${Deno.env.get("SUPABASE_PROJECT_REF") || "rvvujgbaswecqohixgog"}.supabase.co`;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    
    // Debug logging (remove in production if needed)
    console.log("🔍 Checking secrets:", {
      hasSupabaseUrl: !!supabaseUrl,
      hasServiceKey: !!supabaseServiceKey,
      hasPostmarkKey: !!Deno.env.get("POSTMARK_API_KEY"),
    });

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("❌ Missing Supabase credentials");
      return new Response(
        JSON.stringify({
          success: false,
          message: "Server configuration error",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create Supabase admin client (has service role key)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Generate password reset token using Admin API
    // This generates the token without sending email
    const { data: resetData, error: resetError } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: email.trim().toLowerCase(),
    });

    if (resetError || !resetData) {
      console.error("❌ Error generating reset link:", resetError);
      return new Response(
        JSON.stringify({
          success: false,
          message: resetError?.message || "Failed to generate reset link",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const resetLink = resetData.properties?.action_link;
    const hashedToken = resetData.properties?.hashed_token;

    if (!resetLink) {
      console.error("❌ No reset link in response:", resetData);
      return new Response(
        JSON.stringify({
          success: false,
          message: "Failed to generate reset link",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Replace redirect_to parameter to make Supabase redirect to our deep link
    // Supabase's generateLink already includes a redirect_to, so we need to replace it
    const deepLinkUrl = (typeof redirect_to === "string" && redirect_to.trim())
      ? redirect_to.trim()
      : "myapp://reset-password";
    
    // Parse the URL and replace the redirect_to parameter
    let resetUrl: string;
    try {
      const url = new URL(resetLink);
      // Remove existing redirect_to parameter if it exists
      url.searchParams.delete("redirect_to");
      // Add our deep link as redirect_to
      url.searchParams.set("redirect_to", deepLinkUrl);
      resetUrl = url.toString();
    } catch (e) {
      // Fallback: simple string replacement if URL parsing fails
      console.log("⚠️ URL parsing failed, using string replacement");
      const deepLinkEncoded = encodeURIComponent(deepLinkUrl);
      // Remove existing redirect_to parameter (if present)
      const cleanLink = resetLink.replace(/[&?]redirect_to=[^&]*/g, "");
      // Add our redirect_to parameter
      resetUrl = cleanLink.includes("?") 
        ? `${cleanLink}&redirect_to=${deepLinkEncoded}`
        : `${cleanLink}?redirect_to=${deepLinkEncoded}`;
    }

    // Email content
    const subject = "Reset Your Password - 60seconds";
    const emailContent = `Hello,

You requested to reset your password for your 60seconds account.

Click the link below to reset your password:

${resetUrl}

This link will expire in 1 hour.

If you didn't request this password reset, please ignore this email. Your password will remain unchanged.

Best regards,
60seconds Team
Website: https://60secondsapp.io`;

    // Use Postmark to send email (fast!)
    const POSTMARK_API_KEY = Deno.env.get("POSTMARK_API_KEY");
    
    if (POSTMARK_API_KEY) {
      try {
        const postmarkResponse = await fetch("https://api.postmarkapp.com/email", {
          method: "POST",
          headers: {
            "X-Postmark-Server-Token": POSTMARK_API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify({
            From: "60seconds <support@60secondsapp.io>",
            To: email.trim().toLowerCase(),
            Subject: subject,
            TextBody: emailContent,
            MessageStream: "outbound",
          }),
        });
        
        let postmarkData;
        try {
          postmarkData = await postmarkResponse.json();
        } catch (jsonError) {
          const textResponse = await postmarkResponse.text();
          console.error("❌ Postmark API returned non-JSON response:", {
            status: postmarkResponse.status,
            statusText: postmarkResponse.statusText,
            body: textResponse,
          });
          throw new Error(`Postmark API error: ${postmarkResponse.status} ${postmarkResponse.statusText}`);
        }
        
        if (postmarkResponse.ok) {
          console.log("✅ Password reset email sent via Postmark:", {
            messageId: postmarkData.MessageID,
            to: email,
          });
          const payload: Record<string, unknown> = {
            success: true,
            message: "Password reset email sent successfully",
            provider: "Postmark",
            messageId: postmarkData.MessageID,
          };
          if (hashedToken && typeof hashedToken === "string") {
            payload.hashed_token = hashedToken;
          }
          return new Response(
            JSON.stringify(payload),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } else {
          console.error("❌ Postmark API error:", {
            status: postmarkResponse.status,
            statusText: postmarkResponse.statusText,
            error: postmarkData,
          });
          throw new Error(`Postmark API error ${postmarkResponse.status}: ${postmarkData?.Message || JSON.stringify(postmarkData)}`);
        }
      } catch (postmarkError: any) {
        console.error("❌ Postmark API request failed:", {
          error: postmarkError?.message || String(postmarkError),
        });
        return new Response(
          JSON.stringify({
            success: false,
            message: "Failed to send email via Postmark",
            error: postmarkError?.message || String(postmarkError),
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    } else {
      // Fallback: Log if Postmark not configured
      console.log("📧 Password Reset Email (Logging Only - Postmark not configured):", {
        to: email,
        resetUrl: resetUrl.substring(0, 50) + "...",
      });
      
      return new Response(
        JSON.stringify({
          success: false,
          message: "Email service not configured. Please set POSTMARK_API_KEY secret.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  } catch (error: any) {
    console.error("❌ Error in send-password-reset Edge Function:", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: error.message || "Failed to send password reset email",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

