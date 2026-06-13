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
  `https://${Deno.env.get("SUPABASE_PROJECT_REF") || ""}.supabase.co`;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const backfillAdminToken = Deno.env.get("BACKFILL_ADMIN_TOKEN") || "";

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing Supabase environment for backfill-external-settlements");
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Provider = "paystack" | "twint" | "worldline";

const DEFAULT_PLATFORM_FEE_RATE = 0.04;
const roundMoney = (value: number) => Number(Number(value || 0).toFixed(2));

const normalizeProvider = (order: any): Provider | null => {
  const value = String(order?.payment_method || "").trim().toLowerCase();
  if (value === "paystack" || value === "twint" || value === "worldline") {
    return value;
  }
  return null;
};

const deriveNetAmount = (grossAmount: number) => roundMoney(grossAmount / (1 + DEFAULT_PLATFORM_FEE_RATE));

const buildTransactionItems = (order: any) =>
  (Array.isArray(order?.items) ? order.items : []).map((item: any) => ({
    productId: item?.product_id,
    quantity: item?.quantity,
    unitPrice: item?.price,
  }));

const ensureWalletForUser = async (userId: string, currency: string, isVerified = true) => {
  const nowIso = new Date().toISOString();
  const { data: wallet, error } = await supabaseAdmin
    .from("wallets")
    .upsert(
      {
        user_id: userId,
        currency,
        is_verified: isVerified,
        is_active: true,
        updated_at: nowIso,
      },
      { onConflict: "user_id" }
    )
    .select("id, user_id, balance, currency")
    .single();

  if (error || !wallet) {
    throw new Error(`Failed to ensure wallet for user ${userId}: ${error?.message || "unknown"}`);
  }

  return wallet;
};

const adjustWalletBalance = async (walletId: string, delta: number) => {
  const { data: wallet, error: walletError } = await supabaseAdmin
    .from("wallets")
    .select("id,balance")
    .eq("id", walletId)
    .single();

  if (walletError || !wallet) {
    throw new Error(`Failed to load wallet ${walletId} for balance adjustment: ${walletError?.message || "unknown"}`);
  }

  const nextBalance = roundMoney(Number(wallet.balance || 0) + delta);
  const { error: updateError } = await supabaseAdmin
    .from("wallets")
    .update({ balance: nextBalance, updated_at: new Date().toISOString() })
    .eq("id", walletId);

  if (updateError) {
    throw new Error(`Failed to adjust wallet ${walletId}: ${updateError.message}`);
  }

  return nextBalance;
};

const resolveOwnerId = async (order: any) => {
  if (order?.business_id) return order.business_id as string;

  const productIds = Array.from(
    new Set(
      (Array.isArray(order?.items) ? order.items : [])
        .map((item: any) => item?.product_id)
        .filter((value: any): value is string => !!value)
    )
  );

  if (!productIds.length && order?.event_id) {
    const { data: eventRow, error: eventError } = await supabaseAdmin
      .from("events")
      .select("id, user_id")
      .eq("id", order.event_id)
      .single();

    if (eventError) {
      throw new Error(`Failed to resolve event owner for order ${order.id}: ${eventError.message}`);
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
    throw new Error(`Failed to resolve products for order ${order.id}: ${productsError.message}`);
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
      throw new Error(`Failed to resolve events for order ${order.id}: ${eventsError.message}`);
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
    throw new Error(`Order ${order.id} spans multiple owners and cannot be backfilled safely.`);
  }

  return Array.from(owners)[0] || null;
};

const getExistingOwnerCredit = async (orderId: string, provider: Provider) => {
  const { data, error } = await supabaseAdmin
    .from("transactions")
    .select("id, wallet_id, amount, metadata")
    .eq("metadata->>entry", "owner_credit")
    .eq("metadata->>order_id", orderId)
    .eq("metadata->>payment_provider", provider)
    .limit(1);

  if (error) {
    throw new Error(`Failed to check settlement for order ${orderId}: ${error.message}`);
  }

  return (data || [])[0] || null;
};

const getExistingBuyerDebits = async (orderId: string, provider: Provider) => {
  const { data, error } = await supabaseAdmin
    .from("transactions")
    .select("id, wallet_id, amount, metadata")
    .eq("metadata->>entry", "buyer_debit")
    .eq("metadata->>order_id", orderId)
    .eq("metadata->>payment_provider", provider);

  if (error) {
    throw new Error(`Failed to load buyer debit rows for order ${orderId}: ${error.message}`);
  }

  return data || [];
};

const createOwnerCredit = async (params: {
  order: any;
  provider: Provider;
  ownerId: string;
  grossAmount: number;
  netAmount: number;
  platformFeeAmount: number;
  currency: string;
  transactionItems: any[];
}) => {
  const { order, provider, ownerId, grossAmount, netAmount, platformFeeAmount, currency, transactionItems } = params;
  const nowIso = new Date().toISOString();
  const ownerWallet = await ensureWalletForUser(ownerId, currency, true);
  await adjustWalletBalance(ownerWallet.id, netAmount);

  const { error: ownerTxError } = await supabaseAdmin.from("transactions").insert({
    wallet_id: ownerWallet.id,
    amount: netAmount,
    type: "deposit",
    status: "completed",
    description: `${provider === "paystack" ? "Paystack" : provider === "twint" ? "Twint" : "Worldline"} sale settlement (backfill)`,
    transaction_fee: 0,
    metadata: {
      entry: "owner_credit",
      payment_provider: provider,
      owner_id: ownerId,
      buyer_id: order.user_id,
      order_id: order.id,
      video_id: order.video_id || null,
      payment_reference: null,
      payment_transaction_id: null,
      gross_amount: grossAmount,
      platform_fee_amount: platformFeeAmount,
      net_amount: netAmount,
      currency,
      items: transactionItems,
      backfilled_at: nowIso,
    },
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (ownerTxError) {
    throw new Error(`Failed to insert owner transaction for order ${order.id}: ${ownerTxError.message}`);
  }
};

const ensureBuyerDebit = async (params: {
  order: any;
  provider: Provider;
  ownerId: string;
  grossAmount: number;
  netAmount: number;
  platformFeeAmount: number;
  currency: string;
  transactionItems: any[];
  existingBuyerDebits: any[];
}) => {
  const { order, provider, ownerId, grossAmount, netAmount, platformFeeAmount, currency, transactionItems, existingBuyerDebits } = params;
  const nowIso = new Date().toISOString();

  if (!existingBuyerDebits.length) {
    const buyerWallet = await ensureWalletForUser(order.user_id, currency, false);
    await supabaseAdmin.from("transactions").insert({
      wallet_id: buyerWallet.id,
      amount: -grossAmount,
      type: "payment",
      status: "completed",
      description: `${provider === "paystack" ? "Paystack" : provider === "twint" ? "Twint" : "Worldline"} purchase (backfill)`,
      transaction_fee: platformFeeAmount,
      metadata: {
        entry: "buyer_debit",
        payment_provider: provider,
        order_id: order.id,
        owner_id: ownerId,
        payment_reference: null,
        payment_transaction_id: null,
        gross_amount: grossAmount,
        platform_fee_amount: platformFeeAmount,
        net_amount: netAmount,
        currency,
        items: transactionItems,
        backfilled_at: nowIso,
      },
      created_at: nowIso,
      updated_at: nowIso,
    });
    return;
  }

  await Promise.all(
    existingBuyerDebits.map((row) => {
      const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
      return supabaseAdmin
        .from("transactions")
        .update({
          metadata: {
            ...metadata,
            owner_id: ownerId,
            gross_amount: grossAmount,
            platform_fee_amount: platformFeeAmount,
            net_amount: netAmount,
            currency,
          },
          updated_at: nowIso,
        })
        .eq("id", row.id);
    })
  );
};

const repairOwnerCreditIfNeeded = async (params: {
  existingOwnerCredit: any;
  correctOwnerId: string;
  grossAmount: number;
  netAmount: number;
  platformFeeAmount: number;
  currency: string;
  order: any;
  provider: Provider;
  transactionItems: any[];
}) => {
  const { existingOwnerCredit, correctOwnerId, grossAmount, netAmount, platformFeeAmount, currency, order, provider, transactionItems } = params;
  if (!existingOwnerCredit) return false;

  const metadata = existingOwnerCredit?.metadata && typeof existingOwnerCredit.metadata === "object" ? existingOwnerCredit.metadata : {};
  const existingOwnerId = String(metadata.owner_id || "").trim() || null;
  const nowIso = new Date().toISOString();

  if (existingOwnerId === correctOwnerId && Math.abs(Number(existingOwnerCredit.amount || 0) - netAmount) < 0.01) {
    return false;
  }

  const targetWallet = await ensureWalletForUser(correctOwnerId, currency, true);

  if (existingOwnerCredit.wallet_id && existingOwnerCredit.wallet_id !== targetWallet.id) {
    await adjustWalletBalance(existingOwnerCredit.wallet_id, -Math.abs(Number(existingOwnerCredit.amount || 0)));
    await adjustWalletBalance(targetWallet.id, netAmount);
  } else {
    await adjustWalletBalance(targetWallet.id, netAmount - Number(existingOwnerCredit.amount || 0));
  }

  const { error: updateError } = await supabaseAdmin
    .from("transactions")
    .update({
      wallet_id: targetWallet.id,
      amount: netAmount,
      metadata: {
        ...metadata,
        payment_provider: provider,
        owner_id: correctOwnerId,
        buyer_id: order.user_id,
        order_id: order.id,
        video_id: order.video_id || null,
        gross_amount: grossAmount,
        platform_fee_amount: platformFeeAmount,
        net_amount: netAmount,
        currency,
        items: transactionItems,
        repaired_at: nowIso,
      },
      updated_at: nowIso,
    })
    .eq("id", existingOwnerCredit.id);

  if (updateError) {
    throw new Error(`Failed to repair owner credit for order ${order.id}: ${updateError.message}`);
  }

  return true;
};

const settleOrder = async (order: any, provider: Provider) => {
  const ownerId = await resolveOwnerId(order);
  if (!ownerId) {
    throw new Error(`Could not resolve owner for order ${order.id}.`);
  }

  const grossAmount = roundMoney(Number(order.total_amount ?? 0));
  if (!(grossAmount > 0)) {
    throw new Error(`Order ${order.id} has no gross amount to settle.`);
  }

  const netAmount = deriveNetAmount(grossAmount);
  const platformFeeAmount = roundMoney(Math.max(0, grossAmount - netAmount));
  const firstItemCurrency = Array.isArray(order?.items)
    ? order.items.find((item: any) => item?.currency)?.currency
    : null;
  const currency = String(firstItemCurrency || "USD").toUpperCase();
  const nowIso = new Date().toISOString();
  const transactionItems = buildTransactionItems(order);
  const existingOwnerCredit = await getExistingOwnerCredit(order.id, provider);
  const existingBuyerDebits = await getExistingBuyerDebits(order.id, provider);

  const repaired = await repairOwnerCreditIfNeeded({
    existingOwnerCredit,
    correctOwnerId: ownerId,
    grossAmount,
    netAmount,
    platformFeeAmount,
    currency,
    order,
    provider,
    transactionItems,
  });

  if (!existingOwnerCredit) {
    await createOwnerCredit({
      order,
      provider,
      ownerId,
      grossAmount,
      netAmount,
      platformFeeAmount,
      currency,
      transactionItems,
    });
  }

  await ensureBuyerDebit({
    order,
    provider,
    ownerId,
    grossAmount,
    netAmount,
    platformFeeAmount,
    currency,
    transactionItems,
    existingBuyerDebits,
  });

  const { error: orderUpdateError } = await supabaseAdmin
    .from("orders")
    .update({
      business_id: ownerId,
      status: "completed",
      updated_at: nowIso,
    })
    .eq("id", order.id);

  if (orderUpdateError) {
    throw new Error(`Failed to update order ${order.id}: ${orderUpdateError.message}`);
  }

  return {
    orderId: order.id,
    ownerId,
    grossAmount,
    netAmount,
    platformFeeAmount,
    repaired,
    createdOwnerCredit: !existingOwnerCredit,
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.adminToken || "").trim();

    if (!backfillAdminToken || token !== backfillAdminToken) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: orders, error } = await supabaseAdmin
      .from("orders")
      .select("id, user_id, business_id, total_amount, video_id, event_id, items, payment_method, status, created_at")
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(`Failed to load orders: ${error.message}`);
    }

    const providerCandidates = (orders || []).filter((order) => normalizeProvider(order));
    const candidateOrderIds = providerCandidates.map((order) => order.id);

    const { data: ticketReceipts, error: ticketReceiptsError } = candidateOrderIds.length
      ? await supabaseAdmin.from("ticket_receipts").select("order_id").in("order_id", candidateOrderIds)
      : { data: [], error: null };

    if (ticketReceiptsError) {
      throw new Error(`Failed to load ticket receipts: ${ticketReceiptsError.message}`);
    }

    const paidOrderIds = new Set((ticketReceipts || []).map((receipt: any) => receipt.order_id));

    const candidates = providerCandidates.filter((order) => {
      const normalizedStatus = String(order.status || "").trim().toLowerCase();
      return (
        normalizedStatus === "completed" ||
        normalizedStatus === "success" ||
        normalizedStatus === "paid" ||
        paidOrderIds.has(order.id)
      );
    });

    let settledCount = 0;
    let repairedCount = 0;
    let skippedCount = 0;
    const settledOrderIds: string[] = [];

    for (const order of candidates) {
      const provider = normalizeProvider(order);
      if (!provider) {
        skippedCount += 1;
        continue;
      }

      const result = await settleOrder(order, provider);
      if (result.repaired || result.createdOwnerCredit) {
        settledCount += result.createdOwnerCredit ? 1 : 0;
        repairedCount += result.repaired ? 1 : 0;
        settledOrderIds.push(order.id);
      } else {
        skippedCount += 1;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        settledCount,
        repairedCount,
        skippedCount,
        settledOrderIds,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("backfill-external-settlements error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Unknown backfill error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
