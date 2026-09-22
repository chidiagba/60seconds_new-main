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
const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY") || "";

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

const deriveNetAmount = (
  grossAmount: number,
  explicitNetAmount?: number | null,
  explicitPlatformFeeAmount?: number | null
) => {
  const parsedGross = Number(grossAmount || 0);
  const parsedNet = Number(explicitNetAmount);
  const parsedFee = Number(explicitPlatformFeeAmount);

  if (Number.isFinite(parsedGross) && parsedGross > 0 && Number.isFinite(parsedNet) && parsedNet > 0) {
    // Guardrail: never allow net to exceed gross due to bad client payloads.
    const clampedNet = Math.min(parsedNet, parsedGross);

    if (Number.isFinite(parsedFee) && parsedFee >= 0) {
      const expectedNet = roundMoney(Math.max(0, parsedGross - parsedFee));
      // If client payload net/fee pair does not match gross, fall back to server-side derivation.
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

const verifyPaystackReference = async (reference: string) => {
  if (!paystackSecretKey) {
    throw new Error("PAYSTACK_SECRET_KEY is required to verify Paystack settlement reference.");
  }

  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
      },
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.status !== true || String(payload?.data?.status || "").toLowerCase() !== "success") {
    throw new Error(`Paystack verification failed for ${reference}.`);
  }

  return payload?.data || {};
};

const resolveOwnerId = async (recipientId: string | null | undefined, orderRow: any, items: SettlementItem[]) => {
  if (orderRow?.business_id) return orderRow.business_id;

  const ownerFromItem = items.find((item) => item.ownerId)?.ownerId;
  if (ownerFromItem) return ownerFromItem;

  if (recipientId) return recipientId;

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

const ensureTicketReceiptsAndInventory = async (input: {
  orderId: string;
  buyerId: string;
  ownerId: string;
  orderRow: any;
  items: SettlementItem[];
  fallbackCurrency: string;
  fallbackVideoId?: string | null;
}) => {
  const { orderId, buyerId, ownerId, orderRow, items, fallbackCurrency, fallbackVideoId } = input;

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
  for (const item of items || []) {
    const productId = String(item?.productId || "").trim();
    if (!productId) continue;
    normalizedItems.push({
      productId,
      quantity: Math.max(1, Number(item?.quantity || 1)),
      unitPrice: Number(item?.unitPrice || 0),
      currency: item?.currency,
    });
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
        video_id: event?.video_id || fallbackVideoId || orderRow?.video_id || null,
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

    let verifiedPaystackData: any = null;
    if (provider === "paystack" && paymentReference) {
      verifiedPaystackData = await verifyPaystackReference(paymentReference);
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

    const alreadySettled = (existingTxQuery.data || []).length > 0;

    const ownerId = await resolveOwnerId(recipientId, orderRow, items);
    if (!ownerId) {
      throw new Error("Could not resolve owner for external payment settlement.");
    }

    const verifiedGrossAmount =
      provider === "paystack" && verifiedPaystackData
        ? roundMoney(Number(verifiedPaystackData?.amount || 0) / 100)
        : null;

    const grossAmount = roundMoney(
      Number(
        verifiedGrossAmount ??
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
      ),
      Number(
        body?.platformFeeAmount ??
          null
      )
    );

    const platformFeeAmount = roundMoney(Math.max(0, grossAmount - netAmount));
    const orderItemCurrency = Array.isArray(orderRow?.items)
      ? orderRow.items.find((item: any) => item?.currency)?.currency
      : null;
    const verifiedCurrency =
      provider === "paystack" && verifiedPaystackData?.currency
        ? String(verifiedPaystackData.currency).toUpperCase()
        : null;
    const currency = String(verifiedCurrency || currencyOverride || orderItemCurrency || "USD").toUpperCase();
    const effectivePaymentTransactionId =
      provider === "paystack" && verifiedPaystackData?.id
        ? String(verifiedPaystackData.id)
        : paymentTransactionId;

    if (provider === "paystack") {
      const { data: paymentAttempt, error: paymentAttemptError } = await supabaseAdmin
        .from("payments").select("id,amount,currency,organizer_id")
        .eq("payment_provider", "paystack").eq("provider_reference", paymentReference).single();
      if (paymentAttemptError || !paymentAttempt) throw new Error("Unknown Paystack payment reference for this order.");
      if (Math.abs(Number(paymentAttempt.amount) - grossAmount) > 0.01 || String(paymentAttempt.currency).toUpperCase() !== currency) {
        throw new Error("Verified Paystack amount or currency does not match the server-created payment attempt.");
      }
      const { error: paidPaymentError } = await supabaseAdmin.from("payments").update({
        status: "completed", provider_status: String(verifiedPaystackData?.status || "success"),
        transaction_id: effectivePaymentTransactionId, gateway_reference: paymentReference,
        gateway_response: verifiedPaystackData, authorization_code: verifiedPaystackData?.authorization?.authorization_code || null,
        completed_at: new Date().toISOString(), paid_at: verifiedPaystackData?.paid_at || new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", paymentAttempt.id);
      if (paidPaymentError) throw new Error(`Failed to update payment attempt: ${paidPaymentError.message}`);
    }

    if (provider === "paystack") {
      const { data: ledgerResult, error: ledgerError } = await supabaseAdmin.rpc("finalize_paystack_ledger", {
        p_order_id: orderId, p_reference: paymentReference, p_transaction_id: effectivePaymentTransactionId,
        p_owner_id: ownerId, p_buyer_id: orderRow.user_id, p_gross: grossAmount,
        p_net: netAmount, p_fee: platformFeeAmount, p_currency: currency,
        p_metadata: { items },
      });
      if (ledgerError) throw new Error(`Canonical payment finalization failed: ${ledgerError.message}`);
      await ensureTicketReceiptsAndInventory({ orderId, buyerId: orderRow.user_id, ownerId, orderRow, items,
        fallbackCurrency: currency, fallbackVideoId: videoId || orderRow.video_id || null });
      return new Response(JSON.stringify({ success: true, alreadySettled: !!ledgerResult?.alreadyFinalized,
        orderId, ownerId, ownerWalletId: ledgerResult?.walletId, grossAmount, platformFeeAmount, netAmount,
        ownerWalletBalance: ledgerResult?.walletBalance }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let ownerWalletId: string | null = null;
    let ownerNewBalance: number | null = null;

    if (!alreadySettled) {
      const { data: ownerWallet, error: ownerWalletError } = await supabaseAdmin
        .from("wallets")
        .upsert(
          {
            user_id: ownerId,
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

      ownerWalletId = ownerWallet.id;
      const ownerCurrentBalance = Number(ownerWallet.balance || 0);
      ownerNewBalance = roundMoney(ownerCurrentBalance + netAmount);

      const { error: ownerWalletUpdateError } = await supabaseAdmin
        .from("wallets")
        .update({ balance: ownerNewBalance, updated_at: new Date().toISOString() })
        .eq("id", ownerWallet.id);

      if (ownerWalletUpdateError) {
        throw new Error(`Failed to update owner wallet balance: ${ownerWalletUpdateError.message}`);
      }
    }

    const nowIso = new Date().toISOString();
    const paidAtCandidate = metadata?.paidAt || metadata?.paid_at;
    const paidAtIso = paidAtCandidate && !Number.isNaN(Date.parse(String(paidAtCandidate)))
      ? new Date(String(paidAtCandidate)).toISOString()
      : nowIso;
    if (!alreadySettled) {
      const ownerTransaction = {
        wallet_id: ownerWalletId,
        amount: netAmount,
        type: "deposit",
        status: "completed",
        description: provider === "paystack"
          ? "Payment received and sent to Paystack subaccount"
          : `${provider === "twint" ? "Twint" : "Worldline"} sale settlement`,
        transaction_fee: 0,
        metadata: {
          entry: "owner_credit",
          lifecycle_stage: provider === "paystack" ? "in_paystack_subaccount" : "received",
          payment_provider: provider,
          owner_id: ownerId,
          buyer_id: orderRow.user_id,
          order_id: orderId,
          video_id: videoId || orderRow.video_id || null,
          payment_reference: paymentReference,
          payment_transaction_id: effectivePaymentTransactionId,
          gross_amount: grossAmount,
          platform_fee_amount: platformFeeAmount,
          net_amount: netAmount,
          currency,
          items,
        },
        created_at: paidAtIso,
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
            payment_transaction_id: effectivePaymentTransactionId,
            gross_amount: grossAmount,
            platform_fee_amount: platformFeeAmount,
            net_amount: netAmount,
            currency,
            items,
          },
          created_at: paidAtIso,
          updated_at: nowIso,
        });
      }
    }

    let orderUpdatePayload: Record<string, any> = {
      status: "open",
      payment_status: "paid",
      payment_method: provider,
      payment_provider: provider,
      payment_reference: paymentReference,
      payment_transaction_id: effectivePaymentTransactionId,
      payment_metadata: {
        ...(metadata || {}),
        settlement_entry: "owner_credit",
        owner_id: ownerId,
        gross_amount: grossAmount,
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

    if (orderUpdateError && /column|payment_provider|payment_reference|payment_transaction_id|payment_metadata|payment_status/i.test(orderUpdateError.message || "")) {
      // Backward-compatible fallback for projects that still use the older orders schema.
      orderUpdatePayload = {
        status: "open",
        payment_method: provider,
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

    await ensureTicketReceiptsAndInventory({
      orderId,
      buyerId: orderRow.user_id,
      ownerId,
      orderRow,
      items,
      fallbackCurrency: currency,
      fallbackVideoId: videoId || orderRow.video_id || null,
    });

    return new Response(
      JSON.stringify({
        success: true,
        alreadySettled,
        orderId,
        ownerId,
        ownerWalletId,
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
