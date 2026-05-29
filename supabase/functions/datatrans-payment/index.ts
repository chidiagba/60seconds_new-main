// Supabase Edge Function for Datatrans Payment Processing
// Based on Datatrans API Reference: https://api-reference.datatrans.ch/
// This replaces the need for a separate Node.js backend server

// @ts-ignore - Deno is available in Supabase Edge Functions runtime
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get environment variables (set in Supabase Dashboard)
    const DATATRANS_MERCHANT_ID = Deno.env.get("DATATRANS_MERCHANT_ID") || "";
    const DATATRANS_PASSWORD = Deno.env.get("DATATRANS_PASSWORD") || "";
    const DATATRANS_BASE_URL =
      Deno.env.get("DATATRANS_BASE_URL") ||
      "https://api.datatrans.com";

    // Verify credentials are configured
    if (!DATATRANS_MERCHANT_ID || !DATATRANS_PASSWORD) {
      console.error("❌ Datatrans credentials not configured");
      return new Response(
        JSON.stringify({
          success: false,
          message: "Datatrans credentials not configured in Supabase Edge Function secrets",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

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

    const {
      email,
      amount,
      currency = "CHF",
      reference,
      cardNumber,
      expiryMonth,
      expiryYear,
      cvv,
      cardholderName,
      userId,
      paymentType = "wallet_funding",
      metadata = {},
    } = body;

    // Validate required fields
    const missingFields = [];
    if (!email) missingFields.push("email");
    if (!amount || amount <= 0) missingFields.push("amount");
    if (!reference) missingFields.push("reference");
    if (!cardNumber) missingFields.push("cardNumber");
    if (!expiryMonth) missingFields.push("expiryMonth");
    if (!expiryYear) missingFields.push("expiryYear");
    if (!cvv) missingFields.push("cvv");
    if (!cardholderName) missingFields.push("cardholderName");

    if (missingFields.length > 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: `Missing required fields: ${missingFields.join(", ")}`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate card number format (remove spaces and check length)
    const cleanCardNumber = cardNumber.replace(/\s/g, "");
    if (cleanCardNumber.length < 13 || cleanCardNumber.length > 19) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Invalid card number format",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Convert amount to cents (smallest currency unit) - Datatrans requirement
    const amountInCents = Math.round(amount * 100);

    // Prepare Datatrans API payload according to official API reference
    // Reference: https://api-reference.datatrans.ch/
    const payload = {
      amount: amountInCents,
      currency: currency.toUpperCase(), // Ensure uppercase
      refno: reference,
      aliasCC: cleanCardNumber,
      expm: expiryMonth.padStart(2, "0"), // Ensure 2 digits
      expy: expiryYear.length === 2 ? `20${expiryYear}` : expiryYear, // Ensure 4 digits
      cvv: cvv,
      cardholder: cardholderName,
      email: email,
      language: "en",
      metadata: {
        ...metadata,
        user_id: userId,
        payment_type: paymentType,
        source: "mobile_app",
        app_name: "60Seconds",
        timestamp: new Date().toISOString(),
      },
    };

    // Create Basic Auth header (Datatrans uses Basic Authentication)
    const authString = btoa(`${DATATRANS_MERCHANT_ID}:${DATATRANS_PASSWORD}`);

    // Call Datatrans API - Official endpoint: /v1/transactions
    const apiUrl = `${DATATRANS_BASE_URL}/v1/transactions`;
    console.log(`📤 Calling Datatrans API: ${apiUrl}`);
    console.log(`📋 Merchant ID: ${DATATRANS_MERCHANT_ID}`);
    console.log(`💰 Amount: ${amount} ${currency} (${amountInCents} cents)`);
    console.log(`🔖 Reference: ${reference}`);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authString}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "60Seconds-App/1.0",
      },
      body: JSON.stringify(payload),
    });

    console.log(`📥 Response Status: ${response.status} ${response.statusText}`);

    // Check if response is JSON
    const responseContentType = response.headers.get("content-type");
    let responseData;
    
    if (responseContentType && responseContentType.includes("application/json")) {
      try {
        responseData = await response.json();
        console.log(`📥 Response Data:`, JSON.stringify(responseData, null, 2));
      } catch (e) {
        console.error("Failed to parse JSON response:", e);
        const textResponse = await response.text();
        throw new Error(`Invalid JSON response from Datatrans: ${textResponse}`);
      }
    } else {
      const textResponse = await response.text();
      console.error("Non-JSON response from Datatrans:", textResponse);
      throw new Error(`Datatrans API returned non-JSON response: ${textResponse}`);
    }

    if (!response.ok) {
      // Extract error message properly according to Datatrans error format
      let errorMessage = `Datatrans payment failed with status ${response.status}`;
      
      // Datatrans error format: { error: { code, message } } or { message: "..." }
      if (responseData?.error) {
        if (typeof responseData.error === "string") {
          errorMessage = responseData.error;
        } else if (responseData.error?.message) {
          errorMessage = responseData.error.message;
        } else if (responseData.error?.code) {
          errorMessage = `Error ${responseData.error.code}: ${responseData.error.message || "Payment failed"}`;
        } else {
          errorMessage = JSON.stringify(responseData.error);
        }
      } else if (responseData?.message) {
        errorMessage = typeof responseData.message === "string" 
          ? responseData.message 
          : JSON.stringify(responseData.message);
      } else if (responseData?.errors && Array.isArray(responseData.errors)) {
        errorMessage = responseData.errors.map((e: any) => e.message || e).join(", ");
      } else if (responseData) {
        errorMessage = JSON.stringify(responseData);
      }

      console.error(`❌ Datatrans API Error: ${errorMessage}`);

      return new Response(
        JSON.stringify({
          success: false,
          data: {
            reference: reference,
            status: "failed",
            amount: amount,
            currency: currency,
            customer: {
              email: email,
              name: cardholderName,
            },
          },
          message: errorMessage,
        }),
        {
          status: 200, // Return 200 so client can parse the error
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Success response - Parse according to Datatrans response format
    // Datatrans returns: { transactionId, status, refno, ... }
    const transactionId =
      responseData.transactionId ||
      responseData.transaction_id ||
      responseData.transactionID ||
      responseData.refno ||
      reference;

    // Map Datatrans status to our status format
    let status = "failed";
    const datatransStatus = (responseData.status || "").toLowerCase();
    if (datatransStatus === "authorized" || datatransStatus === "success" || datatransStatus === "settled") {
      status = "success";
    } else if (datatransStatus === "pending" || datatransStatus === "initiated") {
      status = "pending";
    } else if (datatransStatus === "failed" || datatransStatus === "error" || datatransStatus === "cancelled") {
      status = "failed";
    }

    console.log(`✅ Payment ${status.toUpperCase()}`);
    console.log(`   Transaction ID: ${transactionId}`);
    console.log(`   Status: ${datatransStatus}`);

    return new Response(
      JSON.stringify({
        success: status === "success" || status === "pending",
        data: {
          reference: responseData.refno || responseData.reference || reference,
          status: status,
          transaction_id: transactionId,
          amount: amount,
          currency: currency,
          customer: {
            email: email,
            name: cardholderName,
          },
          gateway_response: responseData,
        },
        message: responseData.message || `Payment ${status === "success" ? "processed successfully" : status === "pending" ? "is pending" : "failed"}`,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    // Extract error message safely
    console.error("❌ Edge Function Error:", error);
    
    let errorMessage = "Payment processing failed";
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (error && typeof error === "object" && "message" in error) {
      errorMessage = String(error.message);
    } else if (error) {
      try {
        errorMessage = JSON.stringify(error);
      } catch {
        errorMessage = String(error);
      }
    }

    return new Response(
      JSON.stringify({
        success: false,
        message: errorMessage,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

