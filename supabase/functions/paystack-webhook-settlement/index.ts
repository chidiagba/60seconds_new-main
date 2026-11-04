import { reconcileGuestPaystack } from '../_shared/guest-paystack.ts';
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

const ensureTicketReceiptsAndInventory = async (input: {
  orderId: string;
  buyerId: string;
  ownerId: string;
  orderRow: any;
  metadata: any;
  fallbackCurrency: string;
}) => {
  const { orderId, buyerId, ownerId, orderRow, metadata, fallbackCurrency } = input;

  const { data: existingReceipts, error: existingReceiptsError } = await supabaseAdmin
    .from("ticket_receipts")
    .select("id")
    .eq("order_id", orderId)
    .limit(1);

  if (existingReceiptsError) {
    throw new Error(`Failed checking existing ticket receipts: ${existingReceiptsError.message}`);
  }
  if ((existingReceipts || []).length > 0) {
    return;
  }

  const normalizedItems: Array<{ productId: string; quantity: number; unitPrice: number; currency?: string }> = [];
  if (Array.isArray(metadata?.items)) {
    for (const item of metadata.items) {
      const productId = String(item?.productId || item?.product_id || "").trim();
      if (!productId) continue;
      normalizedItems.push({
        productId,
        quantity: Math.max(1, Number(item?.quantity || 1)),
        unitPrice: Number(item?.unitPrice || item?.unit_price || item?.price || 0),
        currency: item?.currency,
      });
    }
  }

  if (!normalizedItems.length && Array.isArray(orderRow?.items)) {
    for (const item of orderRow.items) {
      const productId = String(item?.product_id || "").trim();
      if (!productId) continue;
      normalizedItems.push({
        productId,
        quantity: Math.max(1, Number(item?.quantity || 1)),
        unitPrice: Number(item?.price || 0),
        currency: item?.currency,
      });
    }
  }

  if (!normalizedItems.length) {
    return;
  }

  const productIds = Array.from(new Set(normalizedItems.map((item) => item.productId)));
  const { data: products, error: productsError } = await supabaseAdmin
    .from("products")
    .select("id,name,type,price,currency,event_id,business_id,available_quantity,sold_quantity")
    .in("id", productIds);

  if (productsError) {
    throw new Error(`Failed loading products for ticket issuance: ${productsError.message}`);
  }

  const productsById = new Map<string, any>((products || []).map((product: any) => [product.id, product]));
  const eventIds = Array.from(new Set((products || []).map((product: any) => product.event_id).filter(Boolean)));
  let eventsById = new Map<string, any>();

  if (eventIds.length > 0) {
    const { data: events, error: eventsError } = await supabaseAdmin
      .from("events")
      .select("id,user_id,event_name,start_date,end_date,location_name,video_id")
      .in("id", eventIds);

    if (eventsError) {
      throw new Error(`Failed loading events for ticket issuance: ${eventsError.message}`);
    }

    eventsById = new Map<string, any>((events || []).map((event: any) => [event.id, event]));
  }

  const nowIso = new Date().toISOString();
  const orderNumber = `ORD-${String(orderId).slice(0, 8).toUpperCase()}`;
  let serial = 1;
  const rows: Record<string, any>[] = [];

  for (const item of normalizedItems) {
    const product = productsById.get(item.productId);
    if (!product) continue;
    const event = product?.event_id ? eventsById.get(product.event_id) : null;
    const qty = Math.max(1, Number(item.quantity || 1));
    const unitPrice = Number.isFinite(Number(item.unitPrice)) && Number(item.unitPrice) > 0
      ? Number(item.unitPrice)
      : Number(product?.price || 0);
    const receiptType = String(product?.type || "ticket").toLowerCase();
    const isTicket = receiptType === "ticket";
    const receiptCount = isTicket ? qty : 1;

    for (let i = 0; i < receiptCount; i += 1) {
      const receiptQuantity = isTicket ? 1 : qty;
      const seatNo = isTicket ? `A${String(serial).padStart(2, "0")}` : null;
      rows.push({
        order_id: orderId,
        order_number: orderNumber,
        buyer_id: buyerId,
        owner_id: ownerId,
        video_id: event?.video_id || orderRow?.video_id || null,
        event_id: product?.event_id || null,
        product_id: product.id,
        ticket_type: receiptType,
        receipt_kind: isTicket ? "ticket" : "product",
        ticket_title: product?.name || (isTicket ? "Ticket" : "Product"),
        quantity: receiptQuantity,
        unit_price: unitPrice,
        total_price: unitPrice * receiptQuantity,
        currency: String(item.currency || product?.currency || fallbackCurrency || "USD").toUpperCase(),
        qr_code_data: `${isTicket ? "TICKET" : "PRODUCT"}:${orderNumber}:${product.id}:${serial}:${Date.now()}`,
        seat_no: seatNo,
        event_name: event?.event_name || "60seconds Event",
        event_start_date: event?.start_date || null,
        event_end_date: event?.end_date || null,
        location_name: event?.location_name || "Location not specified",
        is_active: true,
        issued_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      });
      serial += 1;
    }
  }

  if (!rows.length) {
    return;
  }

  const { error: ticketInsertError } = await supabaseAdmin.from("ticket_receipts").insert(rows);
  if (ticketInsertError) {
    throw new Error(`Failed creating ticket receipts: ${ticketInsertError.message}`);
  }

  const qtyByProduct = new Map<string, number>();
  for (const item of normalizedItems) {
    qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) || 0) + Math.max(1, Number(item.quantity || 1)));
  }

  for (const [productId, qty] of qtyByProduct.entries()) {
    const product = productsById.get(productId);
    if (!product) continue;

    const { error: stockUpdateError } = await supabaseAdmin.rpc("reconcile_product_inventory", {
      target_product_id: productId,
    });

    if (stockUpdateError) {
      throw new Error(`Failed updating product inventory for ${productId}: ${stockUpdateError.message}`);
    }
  }
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
  const paymentReference = String(data?.reference || "").trim() || null;
  let orderId = String(metadata?.orderId || metadata?.order_id || "").trim();
  let expectedPayment: any = null;
  if (paymentReference) {
    const { data: paymentRow, error: paymentLookupError } = await supabaseAdmin
      .from("payments").select("id,order_id,user_id,organizer_id,amount,currency,status")
      .eq("payment_provider", "paystack").eq("provider_reference", paymentReference).maybeSingle();
    if (paymentLookupError) throw new Error(`Payment lookup failed: ${paymentLookupError.message}`);
    expectedPayment = paymentRow;
    orderId = orderId || String(paymentRow?.order_id || "").trim();
  }
  if (!orderId) {
    throw new Error("Missing orderId in Paystack metadata.");
  }

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
  const expectedAmount = roundMoney(Number(expectedPayment?.amount ?? orderRow.total_amount ?? 0));
  const expectedCurrency = String(expectedPayment?.currency || "NGN").toUpperCase();
  const paidCurrency = String(data?.currency || "NGN").toUpperCase();
  if (Math.abs(effectiveGrossAmount - expectedAmount) > 0.01 || paidCurrency !== expectedCurrency) {
    await supabaseAdmin.from("payments").update({ status: "failed", provider_status: "amount_mismatch",
      failure_reason: `Expected ${expectedAmount} ${expectedCurrency}; received ${effectiveGrossAmount} ${paidCurrency}`,
      gateway_response: data, updated_at: nowIso }).eq("payment_provider", "paystack").eq("provider_reference", paymentReference);
    console.error(JSON.stringify({ event: "payment_amount_mismatch", orderId, paymentReference, expectedAmount, expectedCurrency, effectiveGrossAmount, paidCurrency }));
    throw new Error("Paystack amount or currency does not match the order.");
  }
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
        organizer_id: expectedPayment?.organizer_id || null,
        payment_provider: "paystack",
        provider_reference: paymentReference,
        payment_method_id: data?.authorization?.authorization_code || null,
        amount: effectiveGrossAmount,
        currency,
        status: "completed",
        provider_status: String(data?.status || "success"),
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
        paid_at: data?.paid_at || nowIso,
        updated_at: nowIso,
      },
      { onConflict: "payment_provider,provider_reference" }
    );

  if (paymentUpsertError) {
    throw new Error(`Failed to upsert payment record: ${paymentUpsertError.message}`);
  }

  let orderUpdatePayload: Record<string, any> = {
    status: "open",
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
      items: Array.isArray(orderRow.items) ? orderRow.items : [],
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
      status: "open",
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

  const { data: ledgerResult, error: ledgerError } = await supabaseAdmin.rpc("finalize_paystack_ledger", {
    p_order_id: orderId, p_reference: paymentReference, p_transaction_id: paymentTransactionId,
    p_owner_id: ownerId, p_buyer_id: orderRow.user_id, p_gross: effectiveGrossAmount,
    p_net: netAmount, p_fee: platformFeeAmount, p_currency: currency,
    p_metadata: { items: Array.isArray(orderRow.items) ? orderRow.items : [] },
  });
  if (ledgerError) throw new Error(`Canonical payment finalization failed: ${ledgerError.message}`);

  await ensureTicketReceiptsAndInventory({
    orderId,
    buyerId: orderRow.user_id,
    ownerId,
    orderRow,
    metadata,
    fallbackCurrency: currency,
  });

  console.log(JSON.stringify({ event: "order_completed", orderId, paymentReference, alreadyFinalized: !!ledgerResult?.alreadyFinalized }));
  return { success: true, alreadySettled: !!ledgerResult?.alreadyFinalized, mode: "order_payment", orderId, ownerId,
    grossAmount: effectiveGrossAmount, netAmount, platformFeeAmount, ownerWalletBalance: ledgerResult?.walletBalance };

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
    description: "Payment received and sent to Paystack subaccount",
    transaction_fee: 0,
    metadata: {
      entry: "owner_credit",
      lifecycle_stage: "in_paystack_subaccount",
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
        items: Array.isArray(orderRow.items) ? orderRow.items : [],
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

    if (metadata.guest_order_id && String(data.reference || '').startsWith('guest_paystack_')) return await reconcileGuestPaystack(supabaseAdmin,data.reference);

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
