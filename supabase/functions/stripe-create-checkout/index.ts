import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
const supabaseUrl =
  Deno.env.get("SUPABASE_URL") ||
  `https://${Deno.env.get("SUPABASE_PROJECT_REF") || "rvvujgbaswecqohixgog"}.supabase.co`;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

if (!stripeSecretKey) {
  throw new Error("Missing STRIPE_SECRET_KEY");
}

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing Supabase environment for stripe-create-checkout");
}

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2023-10-16",
});

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type OwnerResolution = {
  ownerId: string | null;
  connectedAccountId: string | null;
};

const resolveOwnerAndConnectedAccount = async (
  productId?: string,
  explicitConnectedAccountId?: string | null
): Promise<OwnerResolution> => {
  const explicit = String(explicitConnectedAccountId || "").trim();
  if (explicit) {
    return {
      ownerId: null,
      connectedAccountId: explicit,
    };
  }

  const resolvedProductId = String(productId || "").trim();
  if (!resolvedProductId) {
    return {
      ownerId: null,
      connectedAccountId: null,
    };
  }

  const { data: productRow, error: productErr } = await supabaseAdmin
    .from("products")
    .select("id, business_id, event_id")
    .eq("id", resolvedProductId)
    .maybeSingle();

  if (productErr) {
    throw new Error(`Failed to resolve product owner: ${productErr.message}`);
  }

  if (!productRow) {
    throw new Error("Product not found for Stripe checkout.");
  }

  let ownerId = String(productRow.business_id || "").trim() || null;

  if (!ownerId && productRow.event_id) {
    const { data: eventRow, error: eventErr } = await supabaseAdmin
      .from("events")
      .select("id, user_id")
      .eq("id", productRow.event_id)
      .maybeSingle();

    if (eventErr) {
      throw new Error(`Failed to resolve event owner: ${eventErr.message}`);
    }

    ownerId = String(eventRow?.user_id || "").trim() || null;
  }

  if (!ownerId) {
    return {
      ownerId: null,
      connectedAccountId: null,
    };
  }

  const { data: profileRow, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("id, stripe_connected_account_id")
    .eq("id", ownerId)
    .maybeSingle();

  if (profileErr) {
    throw new Error(`Failed to resolve Stripe connected account: ${profileErr.message}`);
  }

  const connectedAccountId = String(profileRow?.stripe_connected_account_id || "").trim() || null;

  return {
    ownerId,
    connectedAccountId,
  };
};

const ensureVerifiedBusinessBankAccount = async (ownerId: string | null) => {
  if (!ownerId) return null;

  const { data: bankAccount, error } = await supabaseAdmin
    .from("business_bank_accounts")
    .select("id, is_verified, verification_status, verification_reason, stripe_external_account_id, is_active")
    .eq("user_id", ownerId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.warn("Failed to verify seller bank account status; continuing without payout metadata:", error.message);
    return null;
  }

  if (!bankAccount) {
    console.warn("Seller has no active bank account configured; continuing checkout without payout metadata.");
    return null;
  }

  if (bankAccount.is_verified !== true) {
    const reason = String(bankAccount.verification_reason || "").trim();
    console.warn(
      reason
        ? `Seller bank account is not verified (${reason}); continuing checkout.`
        : "Seller bank account is not verified yet; continuing checkout."
    );
    return bankAccount;
  }

  return bankAccount;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("Received body:", body);

    const {
      amount,
      currency = "usd",
      customerEmail,
      productId,
      productName,
      platformFeeAmount = 0,
      connectedAccountId = null,
    } = body;

    if (!amount || !currency) {
      return new Response(
        JSON.stringify({ error: "Amount and currency are required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const totalAmount = typeof amount === "number" ? amount : parseInt(amount, 10);

    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      return new Response(
        JSON.stringify({ error: "Amount must be a valid positive number." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ownerResolution = await resolveOwnerAndConnectedAccount(productId, connectedAccountId);

    let destinationConnectedAccountId = ownerResolution.connectedAccountId;
    if (productId && !destinationConnectedAccountId) {
      console.warn("No connected Stripe account found for product owner; creating direct platform PaymentIntent.");
    }

    const verifiedBankAccount = await ensureVerifiedBusinessBankAccount(ownerResolution.ownerId);

    const customer = await stripe.customers.create({
      email: customerEmail || undefined,
    });

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: "2023-10-16" },
    );

    // Build PaymentIntent params; support Stripe Connect destination transfers if connectedAccountId provided
    const paymentIntentParams: any = {
      amount: totalAmount,
      currency: currency.toLowerCase(),
      customer: customer.id,
      automatic_payment_methods: { enabled: true },
      metadata: {
        productId: productId || "",
        productName: productName || "",
        ownerId: ownerResolution.ownerId || "",
        stripeConnectedAccountId: destinationConnectedAccountId || "",
        sellerBankAccountId: String(verifiedBankAccount?.id || ""),
      },
    };

    if (destinationConnectedAccountId) {
      // Route funds to the connected account and optionally collect an application fee
      paymentIntentParams.transfer_data = { destination: destinationConnectedAccountId };
      if (platformFeeAmount && Number(platformFeeAmount) > 0) {
        paymentIntentParams.application_fee_amount = Number(platformFeeAmount);
      }
    }

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

    return new Response(
      JSON.stringify({
        paymentIntentClientSecret: paymentIntent.client_secret,
        customerId: customer.id,
        ephemeralKeySecret: ephemeralKey.secret,
        totalAmount,
          ownerId: ownerResolution.ownerId,
          connectedAccountId: destinationConnectedAccountId,
          sellerBankAccountId: verifiedBankAccount?.id || null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("stripe-create-checkout error:", e);
    return new Response(
      JSON.stringify({ error: e?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
