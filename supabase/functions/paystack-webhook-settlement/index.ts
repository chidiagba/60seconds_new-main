// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-paystack-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl =
  Deno.env.get("SUPABASE_URL") ||
  `https://${Deno.env.get("SUPABASE_PROJECT_REF") || ""}.supabase.co`;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY") || "";

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing Supabase environment for paystack-webhook-settlement");
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEFAULT_PLATFORM_FEE_RATE = 0.04;

const roundMoney = (value: number) => Number(Number(value || 0).toFixed(2));

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const deriveNetAmount = (
  grossAmount: number,
  explicitNetAmount?: number | null,
  explicitPlatformFeeAmount?: number | null
) => {
  const parsedGross = Number(grossAmount || 0);
  const parsedNet = Number(explicitNetAmount);
  const parsedFee = Number(explicitPlatformFeeAmount);

  if (Number.isFinite(parsedGross) && parsedGross > 0 && Number.isFinite(parsedNet) && parsedNet > 0) {
    const clampedNet = Math.min(parsedNet, parsedGross);

    if (Number.isFinite(parsedFee) && parsedFee >= 0) {
      const expectedNet = roundMoney(Math.max(0, parsedGross - parsedFee));
      if (Math.abs(expectedNet - clampedNet) <= 0.01) {
        return expectedNet;
      }
    } else {
      return roundMoney(clampedNet);
    }
  }

  if (!Number.isFinite(parsedGross) || parsedGross <= 0) {
    return 0;
  }

  return roundMoney(parsedGross / (1 + DEFAULT_PLATFORM_FEE_RATE));
};

const verifySignature = async (rawBody: string, signatureHeader: string | null) => {
  if (!paystackSecretKey || !signatureHeader) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(paystackSecretKey),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );

  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = toHex(digest);
  return expected.toLowerCase() === String(signatureHeader).trim().toLowerCase();
};

const resolveOwnerId = async (recipientId: string | null | undefined, orderRow: any) => {
  if (orderRow?.business_id) return orderRow.business_id;

  const productIds = Array.from(
    new Set(
      (Array.isArray(orderRow?.items) ? orderRow.items : [])
        .map((item: any) => item?.product_id)
        .filter((value: any): value is string => !!value)
    )
  );

  if (!productIds.length && orderRow?.event_id) {
    const { data: eventRow, error: eventError } = await supabaseAdmin
      .from("events")
      .select("id, user_id")
      .eq("id", orderRow.event_id)
      .single();

    if (eventError) {
      throw new Error(`Failed to resolve event owner for order ${orderRow.id}: ${eventError.message}`);
    }

    return eventRow?.user_id || null;
  }

  if (!productIds.length) {
    return null;
  }

  const { data: products, error: productsError } = await supabaseAdmin
    .from("products")
    .select("id, business_id, event_id")
    .in("id", productIds);

  if (productsError) {
    throw new Error(`Failed to resolve products for order ${orderRow.id}: ${productsError.message}`);
  }

  const eventIds = Array.from(
    new Set((products || []).map((product: any) => product.event_id).filter((value: any) => !!value))
  );

  const eventsById = new Map<string, any>();
  if (eventIds.length) {
    const { data: events, error: eventsError } = await supabaseAdmin
      .from("events")
      .select("id, user_id")
      .in("id", eventIds);

    if (eventsError) {
      throw new Error(`Failed to resolve events for order ${orderRow.id}: ${eventsError.message}`);
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

  if (!owners.size) {
    return recipientId || null;
  }
  if (owners.size > 1) {
    throw new Error(`Order ${orderRow.id} spans multiple owners and cannot be settled safely.`);
  }

  return Array.from(owners)[0] || null;
};

const settleWalletFunding = async (data: any, metadata: any) => {
  const userId = String(metadata?.userId || metadata?.user_id || "").trim();
  if (!userId) {
    throw new Error("Missing userId in Paystack wallet_funding metadata.");
  }

  const paymentReference = String(data?.reference || "").trim() || null;
  const paymentTransactionId = String(data?.id || paymentReference || "").trim() || null;
  const amount = roundMoney(Number(data?.amount || 0) / 100);
  const currency = String(data?.currency || metadata?.currency || "NGN").toUpperCase();
  const nowIso = new Date().toISOString();

  const { data: existingFundingTx, error: existingFundingTxError } = await supabaseAdmin
    .from("transactions")
    .select("id")
    .eq("metadata->>entry", "wallet_funding")
    .eq("metadata->>payment_transaction_id", paymentTransactionId || "")
    .limit(1);

  if (existingFundingTxError) {
    throw new Error(`Failed to check wallet funding idempotency: ${existingFundingTxError.message}`);
  }

  if ((existingFundingTx || []).length > 0) {
    return { success: true, alreadySettled: true, mode: "wallet_funding", userId };
  }

  const { data: wallet, error: walletError } = await supabaseAdmin
    .from("wallets")
    .upsert(
      {
        user_id: userId,
        currency,
        is_active: true,
        updated_at: nowIso,
      },
      { onConflict: "user_id" }
    )
    .select("id,balance")
    .single();

  if (walletError || !wallet) {
    throw new Error(`Failed to prepare wallet funding record: ${walletError?.message || "unknown"}`);
  }

  const newBalance = roundMoney(Number(wallet.balance || 0) + amount);

  const { error: walletUpdateError } = await supabaseAdmin
    .from("wallets")
    .update({ balance: newBalance, updated_at: nowIso })
    .eq("id", wallet.id);

  if (walletUpdateError) {
    throw new Error(`Failed to update funded wallet balance: ${walletUpdateError.message}`);
  }

  const { error: txInsertError } = await supabaseAdmin
    .from("transactions")
    .insert({
      wallet_id: wallet.id,
      amount,
      type: "deposit",
      status: "completed",
      description: `Wallet funding via Paystack - ${paymentReference || paymentTransactionId || "N/A"}`,
      transaction_fee: 0,
      metadata: {
        entry: "wallet_funding",
        payment_provider: "paystack",
        payment_reference: paymentReference,
        payment_transaction_id: paymentTransactionId,
        currency,
        user_id: userId,
      },
      created_at: nowIso,
      updated_at: nowIso,
    });

  if (txInsertError) {
    throw new Error(`Failed to insert wallet funding transaction: ${txInsertError.message}`);
  }

  return { success: true, alreadySettled: false, mode: "wallet_funding", userId, newBalance };
};

const settleOrderPayment = async (data: any, metadata: any) => {
  const orderId = String(metadata?.orderId || metadata?.order_id || "").trim();
  if (!orderId) {
    throw new Error("Missing orderId in Paystack metadata.");
  }

  const paymentReference = String(data?.reference || "").trim() || null;
  const paymentTransactionId = String(data?.id || paymentReference || "").trim() || null;
  const grossAmount = roundMoney(Number(data?.amount || 0) / 100);
  const nowIso = new Date().toISOString();

  const { data: existingSettlement, error: existingSettlementError } = await supabaseAdmin
    .from("transactions")
    .select("id")
    .eq("metadata->>entry", "owner_credit")
    .eq("metadata->>order_id", orderId)
    .eq("metadata->>payment_provider", "paystack")
    .limit(1);

  if (existingSettlementError) {
    throw new Error(`Failed to check settlement idempotency: ${existingSettlementError.message}`);
  }

  const alreadySettled = (existingSettlement || []).length > 0;

  const { data: orderRow, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("id,user_id,business_id,total_amount,video_id,event_id,items")
    .eq("id", orderId)
    .single();

  if (orderError || !orderRow) {
    throw new Error(`Order not found for settlement: ${orderError?.message || orderId}`);
  }

  const effectiveGrossAmount = grossAmount > 0 ? grossAmount : roundMoney(Number(orderRow.total_amount || 0));
  const netAmount = deriveNetAmount(
    effectiveGrossAmount,
    Number(metadata?.netAmount ?? metadata?.net_amount ?? null),
    Number(metadata?.platformFeeAmount ?? metadata?.platform_fee_amount ?? null)
  );
  const platformFeeAmount = roundMoney(Math.max(0, effectiveGrossAmount - netAmount));
  const currency = String(data?.currency || metadata?.currency || "NGN").toUpperCase();

  const ownerId = await resolveOwnerId(metadata?.recipientId || metadata?.recipient_id || null, orderRow);
  if (!ownerId) {
    throw new Error("Could not resolve owner for Paystack settlement.");
  }

  const { error: paymentUpsertError } = await supabaseAdmin
    .from("payments")
    .upsert(
      {
        order_id: orderId,
        user_id: metadata?.userId || orderRow.user_id || null,
        payment_provider: "paystack",
        payment_method_id: data?.authorization?.authorization_code || null,
        amount: effectiveGrossAmount,
        currency,
        status: "completed",
        transaction_id: paymentTransactionId,
        gateway_reference: paymentReference,
        gateway_response: data,
        metadata: {
          ...(metadata || {}),
          owner_id: ownerId,
          gross_amount: effectiveGrossAmount,
          platform_fee_amount: platformFeeAmount,
          net_amount: netAmount,
        },
        processing_fee: platformFeeAmount,
        net_amount: netAmount,
        completed_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "transaction_id" }
    );

  if (paymentUpsertError) {
    throw new Error(`Failed to upsert payment record: ${paymentUpsertError.message}`);
  }

  let orderUpdatePayload: Record<string, any> = {
    status: "completed",
    payment_status: "paid",
    payment_method: "paystack",
    payment_provider: "paystack",
    payment_reference: paymentReference,
    payment_transaction_id: paymentTransactionId,
    payment_metadata: {
      ...(metadata || {}),
      settlement_entry: "owner_credit",
      owner_id: ownerId,
      gross_amount: effectiveGrossAmount,
      platform_fee_amount: platformFeeAmount,
      net_amount: netAmount,
      currency,
    },
    business_id: ownerId,
    updated_at: nowIso,
  };

  let { error: orderUpdateError } = await supabaseAdmin
    .from("orders")
    .update(orderUpdatePayload)
    .eq("id", orderId);

  if (
    orderUpdateError &&
    /column|payment_provider|payment_reference|payment_transaction_id|payment_metadata|payment_status/i.test(
      orderUpdateError.message || ""
    )
  ) {
    orderUpdatePayload = {
      status: "completed",
      payment_method: "paystack",
      business_id: ownerId,
      updated_at: nowIso,
    };

    ({ error: orderUpdateError } = await supabaseAdmin
      .from("orders")
      .update(orderUpdatePayload)
      .eq("id", orderId));
  }

  if (orderUpdateError) {
    throw new Error(`Failed to update order settlement fields: ${orderUpdateError.message}`);
  }

  if (alreadySettled) {
    return {
      success: true,
      alreadySettled: true,
      mode: "order_payment",
      orderId,
      ownerId,
      grossAmount: effectiveGrossAmount,
      netAmount,
      platformFeeAmount,
    };
  }

  const { data: ownerWallet, error: ownerWalletError } = await supabaseAdmin
    .from("wallets")
    .upsert(
      {
        user_id: ownerId,
        currency,
        is_verified: true,
        is_active: true,
        updated_at: nowIso,
      },
      { onConflict: "user_id" }
    )
    .select("id,balance")
    .single();

  if (ownerWalletError || !ownerWallet) {
    throw new Error(`Failed to create/fetch owner wallet: ${ownerWalletError?.message || "unknown"}`);
  }

  const ownerNewBalance = roundMoney(Number(ownerWallet.balance || 0) + netAmount);
  const { error: ownerWalletUpdateError } = await supabaseAdmin
    .from("wallets")
    .update({ balance: ownerNewBalance, updated_at: nowIso })
    .eq("id", ownerWallet.id);

  if (ownerWalletUpdateError) {
    throw new Error(`Failed to update owner wallet balance: ${ownerWalletUpdateError.message}`);
  }

  const { error: ownerTxError } = await supabaseAdmin.from("transactions").insert({
    wallet_id: ownerWallet.id,
    amount: netAmount,
    type: "deposit",
    status: "completed",
    description: "Paystack sale settlement",
    transaction_fee: 0,
    metadata: {
      entry: "owner_credit",
      payment_provider: "paystack",
      owner_id: ownerId,
      buyer_id: orderRow.user_id,
      order_id: orderId,
      video_id: orderRow.video_id || metadata?.videoId || metadata?.video_id || null,
      payment_reference: paymentReference,
      payment_transaction_id: paymentTransactionId,
      gross_amount: effectiveGrossAmount,
      platform_fee_amount: platformFeeAmount,
      net_amount: netAmount,
      currency,
    },
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (ownerTxError) {
    throw new Error(`Failed to insert owner transaction: ${ownerTxError.message}`);
  }

  const { data: buyerWallet } = await supabaseAdmin
    .from("wallets")
    .upsert(
      {
        user_id: orderRow.user_id,
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
      amount: -effectiveGrossAmount,
      type: "payment",
      status: "completed",
      description: "Paystack purchase",
      transaction_fee: platformFeeAmount,
      metadata: {
        entry: "buyer_debit",
        payment_provider: "paystack",
        order_id: orderId,
        owner_id: ownerId,
        payment_reference: paymentReference,
        payment_transaction_id: paymentTransactionId,
        gross_amount: effectiveGrossAmount,
        platform_fee_amount: platformFeeAmount,
        net_amount: netAmount,
        currency,
      },
      created_at: nowIso,
      updated_at: nowIso,
    });
  }

  return {
    success: true,
    alreadySettled: false,
    mode: "order_payment",
    orderId,
    ownerId,
    grossAmount: effectiveGrossAmount,
    netAmount,
    platformFeeAmount,
    ownerWalletBalance: ownerNewBalance,
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-paystack-signature");

    if (!paystackSecretKey) {
      return new Response(JSON.stringify({ error: "PAYSTACK_SECRET_KEY is not configured." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validSignature = await verifySignature(rawBody, signature);
    if (!validSignature) {
      return new Response(JSON.stringify({ error: "Invalid Paystack webhook signature." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = JSON.parse(rawBody || "{}");
    const event = String(body?.event || "").trim().toLowerCase();
    const data = body?.data || {};
    const metadata = data?.metadata && typeof data.metadata === "object" ? data.metadata : {};

    if (event !== "charge.success") {
      return new Response(JSON.stringify({ success: true, ignored: true, event }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const paymentType = String(
      metadata?.paymentType || metadata?.payment_type || metadata?.type || "order_payment"
    )
      .trim()
      .toLowerCase();

    const result =
      paymentType === "wallet_funding"
        ? await settleWalletFunding(data, metadata)
        : await settleOrderPayment(data, metadata);

    return new Response(JSON.stringify({ success: true, event, result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("paystack-webhook-settlement error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Unknown webhook error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
