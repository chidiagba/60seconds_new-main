// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl =
  Deno.env.get("SUPABASE_URL") ||
  `https://${Deno.env.get("SUPABASE_PROJECT_REF") || "rvvujgbaswecqohixgog"}.supabase.co`;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment for settle-external-order-payment");
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEFAULT_PLATFORM_FEE_RATE = 0.04;

type SettlementItem = {
  productId?: string;
  quantity?: number;
  unitPrice?: number;
  currency?: string;
  ownerId?: string | null;
};

const roundMoney = (value: number) => Number(Number(value || 0).toFixed(2));

const normalizeProvider = (value: string) => {
  const provider = String(value || "").trim().toLowerCase();
  if (provider === "paystack" || provider === "twint" || provider === "worldline") {
    return provider;
  }
  throw new Error(`Unsupported provider: ${value}`);
};

const deriveNetAmount = (grossAmount: number, explicitNetAmount?: number | null) => {
  if (Number.isFinite(Number(explicitNetAmount)) && Number(explicitNetAmount) > 0) {
    return roundMoney(Number(explicitNetAmount));
  }

  if (!Number.isFinite(Number(grossAmount)) || Number(grossAmount) <= 0) {
    return 0;
  }

  return roundMoney(Number(grossAmount) / (1 + DEFAULT_PLATFORM_FEE_RATE));
};

const resolveOwnerId = async (recipientId: string | null | undefined, orderRow: any, items: SettlementItem[]) => {
  if (recipientId) return recipientId;
  if (orderRow?.business_id) return orderRow.business_id;

  const ownerFromItem = items.find((item) => item.ownerId)?.ownerId;
  if (ownerFromItem) return ownerFromItem;

  const productIds = Array.from(
    new Set(
      [
        ...(Array.isArray(orderRow?.items) ? orderRow.items.map((item: any) => item?.product_id) : []),
        ...items.map((item) => item.productId),
      ].filter((value): value is string => !!value)
    )
  );

  if (!productIds.length && orderRow?.event_id) {
    const { data: eventRow, error: eventError } = await supabaseAdmin
      .from("events")
      .select("id, user_id")
      .eq("id", orderRow.event_id)
      .single();

    if (eventError) {
      throw new Error(`Failed to resolve event owner for settlement: ${eventError.message}`);
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
    throw new Error(`Failed to resolve products for settlement: ${productsError.message}`);
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

  if (!owners.size) {
    return null;
  }

  if (owners.size > 1) {
    throw new Error("Settlement request spans multiple owners; split the order by owner.");
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

    const body = await req.json();
    const provider = normalizeProvider(body?.provider);
    const orderId = String(body?.orderId || "").trim();
    const paymentReference = body?.paymentReference ? String(body.paymentReference) : null;
    const paymentTransactionId = body?.paymentTransactionId ? String(body.paymentTransactionId) : null;
    const recipientId = body?.recipientId ? String(body.recipientId) : null;
    const currencyOverride = body?.currency ? String(body.currency).toUpperCase() : null;
    const videoId = body?.videoId ? String(body.videoId) : null;
    const items: SettlementItem[] = Array.isArray(body?.items) ? body.items : [];
    const metadata = body?.metadata && typeof body.metadata === "object" ? body.metadata : {};

    if (!orderId) {
      return new Response(JSON.stringify({ error: "orderId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: orderRow, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id, user_id, business_id, total_amount, video_id, event_id, items")
      .eq("id", orderId)
      .single();

    if (orderError || !orderRow) {
      throw new Error(`Order not found for settlement: ${orderError?.message || orderId}`);
    }

    const existingTxQuery = await supabaseAdmin
      .from("transactions")
      .select("id, wallet_id")
      .eq("metadata->>entry", "owner_credit")
      .eq("metadata->>order_id", orderId)
      .eq("metadata->>payment_provider", provider)
      .limit(1);

    if (existingTxQuery.error) {
      throw new Error(`Failed to check settlement idempotency: ${existingTxQuery.error.message}`);
    }

    if ((existingTxQuery.data || []).length > 0) {
      return new Response(
        JSON.stringify({
          success: true,
          alreadySettled: true,
          orderId,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ownerId = await resolveOwnerId(recipientId, orderRow, items);
    if (!ownerId) {
      throw new Error("Could not resolve owner for external payment settlement.");
    }

    const grossAmount = roundMoney(
      Number(
        body?.grossAmount ??
          orderRow.total_amount ??
          0
      )
    );

    const netAmount = deriveNetAmount(
      grossAmount,
      Number(
        body?.netAmount ??
          null
      )
    );

    const platformFeeAmount = roundMoney(Math.max(0, grossAmount - netAmount));
    const orderItemCurrency = Array.isArray(orderRow?.items)
      ? orderRow.items.find((item: any) => item?.currency)?.currency
      : null;
    const currency = String(currencyOverride || orderItemCurrency || "USD").toUpperCase();

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
    const ownerNewBalance = roundMoney(ownerCurrentBalance + netAmount);

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
      amount: netAmount,
      type: "deposit",
      status: "completed",
      description: `${provider === "paystack" ? "Paystack" : provider === "twint" ? "Twint" : "Worldline"} sale settlement`,
      transaction_fee: 0,
      metadata: {
        entry: "owner_credit",
        payment_provider: provider,
        owner_id: ownerId,
        buyer_id: orderRow.user_id,
        order_id: orderId,
        video_id: videoId || orderRow.video_id || null,
        payment_reference: paymentReference,
        payment_transaction_id: paymentTransactionId,
        gross_amount: grossAmount,
        platform_fee_amount: platformFeeAmount,
        net_amount: netAmount,
        currency,
        items,
      },
      created_at: nowIso,
      updated_at: nowIso,
    };

    const { error: ownerTxError } = await supabaseAdmin.from("transactions").insert(ownerTransaction);
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
        amount: -grossAmount,
        type: "payment",
        status: "completed",
        description: `${provider === "paystack" ? "Paystack" : provider === "twint" ? "Twint" : "Worldline"} purchase`,
        transaction_fee: platformFeeAmount,
        metadata: {
          entry: "buyer_debit",
          payment_provider: provider,
          order_id: orderId,
          owner_id: ownerId,
          payment_reference: paymentReference,
          payment_transaction_id: paymentTransactionId,
          gross_amount: grossAmount,
          platform_fee_amount: platformFeeAmount,
          net_amount: netAmount,
          currency,
          items,
        },
        created_at: nowIso,
        updated_at: nowIso,
      });
    }

    const { error: orderUpdateError } = await supabaseAdmin
      .from("orders")
      .update({
        status: "completed",
        business_id: ownerId,
        updated_at: nowIso,
      })
      .eq("id", orderId);

    if (orderUpdateError) {
      throw new Error(`Failed to update order settlement fields: ${orderUpdateError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        alreadySettled: false,
        orderId,
        ownerId,
        ownerWalletId: ownerWallet.id,
        grossAmount,
        platformFeeAmount,
        netAmount,
        ownerWalletBalance: ownerNewBalance,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("settle-external-order-payment error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});