// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe";

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

if (!stripeSecretKey) {
  throw new Error("Stripe Secret Key is missing.");
}

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2023-10-16",
});

const normalizeCurrency = (value: unknown): string => {
  const candidate = String(value || "").trim().toLowerCase();
  return /^[a-z]{3}$/.test(candidate) ? candidate : "usd";
};

const parseAmountCents = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded <= 0) return null;
  return rounded;
};

const parseOptionalAmountCents = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : 0;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
      currency,
      customerEmail,
      productId,
      productName,
      platformFeeAmount,
    } = body;

    if (amount == null || currency == null) {
      return new Response(
        JSON.stringify({ error: "Amount and currency are required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const baseAmount = parseAmountCents(amount);
    if (!baseAmount) {
      return new Response(
        JSON.stringify({ error: "Amount must be a valid positive number." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const feeAmount = parseOptionalAmountCents(platformFeeAmount);
    const totalAmount = baseAmount + feeAmount;
    const normalizedCurrency = normalizeCurrency(currency);

    const customer = await stripe.customers.create({
      email: customerEmail || undefined,
    });

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: "2023-10-16" },
    );

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount,
      currency: normalizedCurrency,
      customer: customer.id,
      automatic_payment_methods: { enabled: true },
      metadata: {
        productId,
        productName,
      },
    });

    return new Response(
      JSON.stringify({
        paymentIntentClientSecret: paymentIntent.client_secret,
        customerId: customer.id,
        ephemeralKeySecret: ephemeralKey.secret,
        totalAmount,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("stripe-create-payment-sheet error:", e);
    return new Response(
      JSON.stringify({ error: e?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
