# 💳 Deploy Datatrans Function via Supabase Dashboard (No CLI)

This guide shows you how to deploy the Datatrans payment function **without using the CLI** - all through the Supabase web dashboard.

---

## 🎯 **Step-by-Step: Deploy via Dashboard**

### **Step 1: Open Supabase Dashboard**

1. Go to: https://supabase.com/dashboard/project/rvvujgbaswecqohixgog
2. Make sure you're logged in
3. Navigate to: **Edge Functions** (in the left sidebar)

---

### **Step 2: Create New Edge Function**

1. Click the **"Create Function"** or **"New Function"** button
2. You'll see a form to create a new function

---

### **Step 3: Configure Function Settings**

Fill in the form:

- **Function Name**: `datatrans-payment`
  - ⚠️ **Important**: The name must be exactly `datatrans-payment` (lowercase, with hyphen)
  
- **Region**: Choose the closest region to your users (e.g., `us-east-1`, `eu-west-1`)

- **Runtime**: Select `Deno` (this is the default for Supabase Edge Functions)

---

### **Step 4: Copy the Function Code**

1. **Open the function code file** on your computer:
   - File location: `supabase/functions/datatrans-payment/index.ts`
   - Or open it in your code editor

2. **Select ALL the code** (Ctrl+A or Cmd+A)

3. **Copy it** (Ctrl+C or Cmd+C)

4. **Paste it into the Supabase Dashboard code editor**

The complete code is shown below (you can copy from here):

```typescript
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
      "https://api.sandbox.datatrans.com";

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
```

---

### **Step 5: Save and Deploy**

1. **Review the code** to make sure it was pasted correctly
2. Click **"Deploy"** or **"Save"** button
3. Wait for deployment to complete (usually takes 10-30 seconds)
4. You should see a success message: ✅ **"Function deployed successfully"**

---

### **Step 6: Set Datatrans Credentials (Secrets)**

Now you need to configure the Datatrans API credentials so the function can access Datatrans.

#### **6.1: Get Your Datatrans Credentials**

1. **Go to Datatrans Dashboard**:
   - **Sandbox (Testing)**: https://admin.sandbox.datatrans.com/Login.jsp
   - **Production**: https://admin.datatrans.com/Login.jsp

2. **Find your credentials**:
   - **Merchant ID**: Usually in Settings → Merchant Information
   - **API Password**: Usually in Settings → API Credentials (this is different from your login password!)

#### **6.2: Set Secrets in Supabase Dashboard**

1. **In Supabase Dashboard**, go to: **Settings** → **Edge Functions** → **Secrets**
   - Or navigate to: **Edge Functions** → **datatrans-payment** → **Settings** → **Secrets**

2. **Add each secret** by clicking **"Add Secret"**:

   **Secret 1:**
   - Name: `DATATRANS_MERCHANT_ID`
   - Value: `1110020919` (replace with your actual Merchant ID)
   - Click **"Save"**

   **Secret 2:**
   - Name: `DATATRANS_PASSWORD`
   - Value: `your_actual_password_here` (replace with your actual API Password)
   - Click **"Save"**

   **Secret 3:**
   - Name: `DATATRANS_BASE_URL`
   - Value: `https://api.sandbox.datatrans.com` (for testing)
   - Or: `https://api.datatrans.com` (for production)
   - Click **"Save"**

3. **Verify secrets are set**:
   - You should see all 3 secrets listed:
     - ✅ `DATATRANS_MERCHANT_ID`
     - ✅ `DATATRANS_PASSWORD`
     - ✅ `DATATRANS_BASE_URL`

---

### **Step 7: Verify Deployment**

1. **Go to**: Edge Functions in Supabase Dashboard
2. **You should see**: `datatrans-payment` listed with a green checkmark ✅
3. **Click on** `datatrans-payment` to view details
4. **Check the Logs tab** to see if there are any errors

---

### **Step 8: Test the Function**

You can test the function directly from the Supabase Dashboard:

1. **Go to**: Edge Functions → `datatrans-payment`
2. **Click**: **"Invoke Function"** or **"Test"** tab
3. **Enter test data**:

```json
{
  "email": "test@example.com",
  "amount": 10.00,
  "currency": "CHF",
  "reference": "test-123",
  "cardNumber": "4242424242424242",
  "expiryMonth": "12",
  "expiryYear": "2025",
  "cvv": "123",
  "cardholderName": "Test User",
  "userId": "test-user-id"
}
```

4. **Click "Invoke"** or **"Run"**
5. **Check the response** - should show success or error message

---

## ✅ **You're Done!**

Your Datatrans payment function is now deployed and ready to use. The app will automatically use this function when processing payments.

---

## 🔧 **Troubleshooting**

### **Function Not Appearing**

- Make sure you clicked **"Deploy"** or **"Save"** after pasting the code
- Refresh the page and check again
- Look for any error messages in the dashboard

### **"Credentials not configured" Error**

- Make sure all 3 secrets are set:
  - `DATATRANS_MERCHANT_ID`
  - `DATATRANS_PASSWORD`
  - `DATATRANS_BASE_URL`
- Check that secret names are **exactly** as shown (case-sensitive)
- Try removing and re-adding the secrets

### **Function Returns Error**

- Check the **Logs** tab in the Edge Function dashboard
- Verify your Datatrans credentials are correct
- Make sure you're using the correct environment (sandbox vs production)

### **Can't Find "Create Function" Button**

- Make sure you're in the **Edge Functions** section
- Check that you have the correct permissions (project owner/admin)
- Try refreshing the page

---

## 📝 **Quick Checklist**

- [ ] ✅ Opened Supabase Dashboard
- [ ] ✅ Navigated to Edge Functions
- [ ] ✅ Created new function named `datatrans-payment`
- [ ] ✅ Pasted the complete code
- [ ] ✅ Deployed the function
- [ ] ✅ Got Datatrans credentials (Merchant ID, Password)
- [ ] ✅ Set `DATATRANS_MERCHANT_ID` secret
- [ ] ✅ Set `DATATRANS_PASSWORD` secret
- [ ] ✅ Set `DATATRANS_BASE_URL` secret
- [ ] ✅ Verified function appears in dashboard
- [ ] ✅ Tested the function

---

## 🎯 **Next Steps**

After deployment:

1. **Test in your app**: Try making a payment in your mobile app
2. **Check logs**: Monitor the Edge Function logs for any issues
3. **Switch to production**: When ready, update `DATATRANS_BASE_URL` to production URL

---

## 📚 **Additional Resources**

- **Supabase Dashboard**: https://supabase.com/dashboard/project/rvvujgbaswecqohixgog
- **Datatrans Sandbox**: https://admin.sandbox.datatrans.com
- **Datatrans API Docs**: https://api-reference.datatrans.ch/

---

**Need Help?** Check the logs in Supabase Dashboard → Edge Functions → `datatrans-payment` → Logs

