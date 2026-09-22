// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
const supabaseUrl =
  Deno.env.get("SUPABASE_URL") ||
  `https://${Deno.env.get("SUPABASE_PROJECT_REF") || "rvvujgbaswecqohixgog"}.supabase.co`;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

if (!stripeSecretKey) {
  throw new Error("Missing STRIPE_SECRET_KEY");
}
if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment for stripe-confirm-and-settle");
}

const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type SettlementItem = {
  productId?: string;
  quantity?: number;
  unitPrice?: number;
  ownerId?: string | null;
};

const toMajor = (amountCents: number) => Number((amountCents / 100).toFixed(2));

const resolveOwnerId = async (
  recipientId: string | null | undefined,
  items: SettlementItem[]
): Promise<string | null> => {
  if (recipientId) return recipientId;

  const ownerFromItem = items.find((it) => it.ownerId)?.ownerId;
  if (ownerFromItem) return ownerFromItem;

  const productIds = Array.from(
    new Set(items.map((it) => it.productId).filter((it): it is string => !!it))
  );

  if (!productIds.length) return null;

  const { data: products, error: productsError } = await supabaseAdmin
    .from("products")
    .select("id, business_id, event_id")
    .in("id", productIds);

  if (productsError) {
    throw new Error(`Failed to resolve products for settlement: ${productsError.message}`);
  }

  const eventIds = Array.from(
    new Set((products || []).map((p: any) => p.event_id).filter((it: any) => !!it))
  );

  const eventsById = new Map<string, any>();
  if (eventIds.length) {
    const { data: events, error: eventsError } = await supabaseAdmin
      .from("events")
      .select("id, user_id")
      .in("id", eventIds);

    if (eventsError) {
      throw new Error(`Failed to resolve event owners for settlement: ${eventsError.message}`);
    }

    for (const eventRow of events || []) {
      eventsById.set(eventRow.id, eventRow);
    }
  }

  const owners = new Set<string>();
  for (const product of products || []) {
    const ownerId = product.business_id || eventsById.get(product.event_id)?.user_id;
    if (ownerId) owners.add(ownerId);
  }

  if (!owners.size) return null;

  if (owners.size > 1) {
    throw new Error("Cart contains products from multiple owners; split by owner for settlement.");
  }

  return Array.from(owners)[0] || null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7)
      : "";

    if (!token) {
      return new Response(JSON.stringify({ error: "Missing bearer token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const buyerId = userData.user.id;

    const body = await req.json();
    const paymentIntentId = String(body?.paymentIntentId || "").trim();
    const orderId = body?.orderId ? String(body.orderId) : null;
    const recipientId = body?.recipientId ? String(body.recipientId) : null;
    const currency = String(body?.currency || "usd").toUpperCase();
    const videoId = body?.videoId ? String(body.videoId) : null;
    const items: SettlementItem[] = Array.isArray(body?.items) ? body.items : [];

    if (!paymentIntentId) {
      return new Response(JSON.stringify({ error: "paymentIntentId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== "succeeded") {
      return new Response(
        JSON.stringify({
          error: `Payment intent is not succeeded yet (status: ${paymentIntent.status})`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const existingTxQuery = await supabaseAdmin
      .from("transactions")
      .select("id, wallet_id")
      .eq("metadata->>stripe_payment_intent_id", paymentIntentId)
      .eq("metadata->>entry", "owner_credit")
      .limit(1);

    if (existingTxQuery.error) {
      throw new Error(`Failed to check idempotency: ${existingTxQuery.error.message}`);
    }

    if ((existingTxQuery.data || []).length > 0) {
      return new Response(
        JSON.stringify({
          success: true,
          alreadySettled: true,
          paymentIntentId,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ownerId = await resolveOwnerId(recipientId, items);
    if (!ownerId) {
      throw new Error("Could not resolve owner for wallet settlement.");
    }

    const connectedAccountId = String((paymentIntent as any)?.transfer_data?.destination || "").trim() || null;

    const { data: bankAccountRow } = await supabaseAdmin
      .from("business_bank_accounts")
      .select("id, stripe_external_account_id")
      .eq("user_id", ownerId)
      .eq("is_active", true)
      .maybeSingle();

    const grossAmountCents =
      Number.isFinite(Number(paymentIntent.amount_received)) && Number(paymentIntent.amount_received) > 0
        ? Number(paymentIntent.amount_received)
        : Number(paymentIntent.amount);

    const platformFeeAmountCents =
      Number.isFinite(Number(paymentIntent.application_fee_amount)) && Number(paymentIntent.application_fee_amount) > 0
        ? Number(paymentIntent.application_fee_amount)
        : Number(body?.platformFeeAmountCents || 0);

    const netAmountCents = Math.max(0, grossAmountCents - platformFeeAmountCents);

    const { data: ownerWallet, error: ownerWalletError } = await supabaseAdmin
      .from("wallets")
      .upsert(
        {
          user_id: ownerId,
          currency,
          is_verified: true,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .select("id, balance")
      .single();

    if (ownerWalletError || !ownerWallet) {
      throw new Error(`Failed to create/fetch owner wallet: ${ownerWalletError?.message || "unknown"}`);
    }

    const ownerCurrentBalance = Number(ownerWallet.balance || 0);
    const ownerNetAmount = toMajor(netAmountCents);
    const ownerNewBalance = Number((ownerCurrentBalance + ownerNetAmount).toFixed(2));

    const { error: ownerWalletUpdateError } = await supabaseAdmin
      .from("wallets")
      .update({ balance: ownerNewBalance, updated_at: new Date().toISOString() })
      .eq("id", ownerWallet.id);

    if (ownerWalletUpdateError) {
      throw new Error(`Failed to update owner wallet balance: ${ownerWalletUpdateError.message}`);
    }

    const nowIso = new Date().toISOString();

    const ownerTransaction = {
      wallet_id: ownerWallet.id,
      amount: ownerNetAmount,
      type: "deposit",
      status: "completed",
      description: "Stripe sale settlement (net)",
      transaction_fee: 0,
      metadata: {
        entry: "owner_credit",
        stripe_payment_intent_id: paymentIntentId,
        stripe_charge_id: paymentIntent.latest_charge,
        owner_id: ownerId,
        stripe_connected_account_id: connectedAccountId,
        seller_bank_account_id: bankAccountRow?.id || null,
        stripe_external_account_id: bankAccountRow?.stripe_external_account_id || null,
        buyer_id: buyerId,
        order_id: orderId,
        video_id: videoId,
        gross_amount: toMajor(grossAmountCents),
        platform_fee_amount: toMajor(platformFeeAmountCents),
        net_amount: ownerNetAmount,
        currency,
        items,
      },
      created_at: nowIso,
      updated_at: nowIso,
    };

    const { error: ownerTxError } = await supabaseAdmin
      .from("transactions")
      .insert(ownerTransaction);

    if (ownerTxError) {
      throw new Error(`Failed to insert owner transaction: ${ownerTxError.message}`);
    }

    const { data: buyerWallet } = await supabaseAdmin
      .from("wallets")
      .upsert(
        {
          user_id: buyerId,
          currency,
          is_active: true,
          updated_at: nowIso,
        },
        { onConflict: "user_id" }
      )
      .select("id")
      .single();

    if (buyerWallet?.id) {
      await supabaseAdmin.from("transactions").insert({
        wallet_id: buyerWallet.id,
        amount: -toMajor(grossAmountCents),
        type: "payment",
        status: "completed",
        description: "Stripe purchase",
        transaction_fee: toMajor(platformFeeAmountCents),
        metadata: {
          entry: "buyer_debit",
          stripe_payment_intent_id: paymentIntentId,
          order_id: orderId,
          owner_id: ownerId,
          stripe_connected_account_id: connectedAccountId,
          seller_bank_account_id: bankAccountRow?.id || null,
          stripe_external_account_id: bankAccountRow?.stripe_external_account_id || null,
          gross_amount: toMajor(grossAmountCents),
          platform_fee_amount: toMajor(platformFeeAmountCents),
          net_amount: ownerNetAmount,
          currency,
          items,
        },
        created_at: nowIso,
        updated_at: nowIso,
      });
    }

    if (orderId) {
      await supabaseAdmin
        .from("orders")
        .update({
          payment_status: "paid",
          status: "open",
          payment_reference: paymentIntentId,
          business_id: ownerId,
          updated_at: nowIso,
        })
        .eq("id", orderId)
        .eq("user_id", buyerId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        alreadySettled: false,
        paymentIntentId,
        ownerId,
        ownerWalletId: ownerWallet.id,
        grossAmount: toMajor(grossAmountCents),
        platformFeeAmount: toMajor(platformFeeAmountCents),
        netAmount: ownerNetAmount,
        ownerWalletBalance: ownerNewBalance,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("stripe-confirm-and-settle error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
