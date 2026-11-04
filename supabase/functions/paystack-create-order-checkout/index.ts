// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const url = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const paystackKey = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const auth = createClient(url, anonKey, { auth: { persistSession: false } });
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const money = (n: number) => Number(n.toFixed(2));
const objectValue = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const firstString = (...values: unknown[]) => {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let orderId = "";
  let reference = "";
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    if (authError || !authData.user) return respond({ error: "Authentication required" }, 401);
    if (!paystackKey) throw new Error("PAYSTACK_SECRET_KEY is not configured");
    const body = await req.json().catch(() => ({}));
    const requested = Array.isArray(body.items) ? body.items : [];
    if (!requested.length) return respond({ error: "At least one product is required" }, 400);
    const quantities = new Map<string, number>();
    for (const item of requested) {
      const id = String(item?.productId || "").trim();
      const qty = Number(item?.quantity || 1);
      if (!id || !Number.isInteger(qty) || qty < 1 || qty > 100) return respond({ error: "Invalid product or quantity" }, 400);
      quantities.set(id, (quantities.get(id) || 0) + qty);
    }
    const ids = [...quantities.keys()];
    const { data: products, error: productError } = await admin.from("products")
      .select("id,business_id,event_id,name,description,type,price,currency,available_quantity,sold_quantity,is_active")
      .in("id", ids);
    if (productError) throw new Error(`Product validation failed: ${productError.message}`);
    if ((products || []).length !== ids.length) return respond({ error: "One or more products no longer exist" }, 409);
    const owners = new Set<string>();
    let currency = "";
    let subtotal = 0;
    const items: any[] = [];
    for (const product of products || []) {
      if (product.is_active === false) return respond({ error: `${product.name} is unavailable` }, 409);
      const qty = quantities.get(product.id) || 0;
      const available = Number(product.available_quantity || 0);
      if (Number.isFinite(available) && available < qty) return respond({ error: `Insufficient availability for ${product.name}` }, 409);
      if (!product.business_id) return respond({ error: `Organizer missing for ${product.name}` }, 409);
      owners.add(product.business_id);
      const productCurrency = String(product.currency || "NGN").toUpperCase();
      if (currency && currency !== productCurrency) return respond({ error: "Mixed currencies are not supported" }, 409);
      currency = productCurrency;
      const unitPrice = Number(product.price || 0);
      subtotal += money(unitPrice * 1.04) * qty;
      items.push({ product_id: product.id, quantity: qty, price: unitPrice, name: product.name, type: product.type, description: product.description, currency: productCurrency });
    }
    if (owners.size !== 1) return respond({ error: "Checkout must contain products from one organizer" }, 409);
    const organizerId = [...owners][0];
    const { data: bankRoutes, error: routeError } = await admin.from("business_bank_accounts")
      .select("is_active,payout_provider,country_code,is_verified,verification_status,paystack_subaccount_code,metadata,updated_at")
      .eq("user_id", organizerId).eq("is_active", true).order("updated_at", { ascending: false }).limit(20);
    // Routing enriches the transaction when available, but it is not a checkout
    // prerequisite. A buyer can always pay into the platform Paystack account.
    if (routeError) console.warn(`Organizer payout routing lookup unavailable: ${routeError.message}`);
    const routeRows = !routeError && Array.isArray(bankRoutes) ? bankRoutes : [];
    const bankRoute = routeRows.find((row: any) => {
      const metadata = objectValue(row?.metadata);
      const embedded = objectValue(metadata.business_bank_account);
      return Boolean(firstString(
        row?.paystack_subaccount_code,
        embedded.paystack_subaccount_code,
        embedded.paystackSubaccountCode,
        metadata.paystack_subaccount_code,
        metadata.paystackSubaccountCode
      ));
    }) || routeRows[0] || null;
    const routeMetadata = objectValue(bankRoute?.metadata);
    const embeddedRoute = objectValue(routeMetadata.business_bank_account);
    let subaccount = firstString(
      bankRoute?.paystack_subaccount_code,
      embeddedRoute.paystack_subaccount_code,
      embeddedRoute.paystackSubaccountCode,
      routeMetadata.paystack_subaccount_code,
      routeMetadata.paystackSubaccountCode
    );
    // Older app versions persisted the generated Paystack codes in auth metadata
    // while the database migration was still rolling out.
    if (!subaccount) {
      const { data: organizerAuth } = await admin.auth.admin.getUserById(organizerId);
      const organizerMetadata = objectValue(organizerAuth?.user?.user_metadata);
      const embeddedOrganizerRoute = objectValue(organizerMetadata.business_bank_account);
      subaccount = firstString(
        embeddedOrganizerRoute.paystack_subaccount_code,
        embeddedOrganizerRoute.paystackSubaccountCode,
        organizerMetadata.paystack_subaccount_code,
        organizerMetadata.paystackSubaccountCode
      );
    }
    let discount = 0;
    const voucherId = String(body.voucherId || "").trim();
    if (voucherId) {
      const { data: voucher } = await admin.from("vouchers").select("*").eq("id", voucherId).eq("business_id", organizerId).eq("is_active", true).maybeSingle();
      if (!voucher) return respond({error: 'Voucher not found or inactive'},400);
      if (voucher.expiry_date && new Date(voucher.expiry_date) <= new Date()) return respond({error:'Voucher has expired'},400);
      if (voucher.usage_limit != null && voucher.usage_count >= voucher.usage_limit) return respond({error:'Voucher usage limit reached'},400);
      if (subtotal < Number(voucher.min_purchase_amount || 0)) return respond({error:'Minimum voucher purchase amount not reached'},400);
      if (voucher.product_id && ids.some(id => id !== voucher.product_id)) return respond({error:'Voucher is only valid for specific products'},400);
      const value = Number(voucher.discount_value ?? voucher.discount_amount);
      discount = voucher.discount_type === 'percentage' ? money(subtotal * value / 100) : value;
      if (voucher.max_discount_amount != null) discount = Math.min(discount,Number(voucher.max_discount_amount));
      discount = Math.min(subtotal,Math.max(0,discount));
    }
    const total = money(subtotal - discount);
    subtotal = money(total / 1.04);
    const platformFee = money(total - subtotal);
    reference = `60seconds_order_${crypto.randomUUID().replaceAll("-", "")}`;
    const { data: order, error: orderError } = await admin.from("orders").insert({
      user_id: authData.user.id, business_id: organizerId, event_id: products?.[0]?.event_id || null,
      video_id: body.videoId || null, total_amount: total, subtotal, platform_fee: platformFee, currency,
      status: "pending", payment_status: "pending", payment_method: "paystack", payment_provider: "paystack",
      payment_reference: reference, source: String(body.platform || "mobile"), items,
      payment_metadata: { voucher_id: voucherId || null, discount_amount: money(discount) },
      expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(), updated_at: new Date().toISOString(),
    }).select("*").single();
    if (orderError || !order) throw new Error(`Order creation failed: ${orderError?.message || "unknown"}`);
    orderId = order.id;
    const { error: paymentError } = await admin.from("payments").insert({
      order_id: order.id, user_id: authData.user.id, organizer_id: organizerId, payment_provider: "paystack",
      provider_reference: reference, gateway_reference: reference, amount: total, currency, status: "pending",
      processing_fee: platformFee, net_amount: subtotal, metadata: { products: ids, voucher_id: voucherId || null },
    });
    if (paymentError) throw new Error(`Payment attempt creation failed: ${paymentError.message}`);
    const metadata = { orderId: order.id, orderNumber: order.order_number, buyerId: authData.user.id, userId: authData.user.id, organizerId, ownerId: organizerId, productId: ids[0], items, paymentType: "order_payment", splitMode: subaccount ? "single_subaccount" : "platform_collection" };
    const paystackPayload: any = {
      email: authData.user.email, amount: Math.round(total * 100), currency, reference,
      callback_url: `myapp://paystack/callback?reference=${encodeURIComponent(reference)}&orderId=${order.id}`,
      metadata,
      channels: Array.isArray(body.channels) && body.channels.length ? body.channels : undefined,
    };
    if (subaccount) {
      paystackPayload.subaccount = subaccount;
      paystackPayload.transaction_charge = Math.round(platformFee * 100);
      paystackPayload.bearer = "account";
    }
    const response = await fetch("https://api.paystack.co/transaction/initialize", { method: "POST", headers: { Authorization: `Bearer ${paystackKey}`, "Content-Type": "application/json" }, body: JSON.stringify(paystackPayload) });
    const initialized = await response.json().catch(() => ({}));
    if (!response.ok || initialized?.status !== true || !initialized?.data?.authorization_url) throw new Error(initialized?.message || "Paystack initialization failed");
    await admin.from("payments").update({ provider_status: "initialized", metadata: { ...metadata, access_code: initialized.data.access_code }, updated_at: new Date().toISOString() }).eq("payment_provider", "paystack").eq("provider_reference", reference);
    console.log(JSON.stringify({ event: "paystack_initialized", orderId, reference }));
    return respond({ success: true, order, payment: { reference, status: "pending" }, authorizationUrl: initialized.data.authorization_url, accessCode: initialized.data.access_code });
  } catch (error) {
    console.error(JSON.stringify({ event: "paystack_initialization_failed", orderId, reference, error: error?.message || String(error) }));
    if (reference) await admin.from("payments").update({ status: "failed", failure_reason: error?.message || String(error), updated_at: new Date().toISOString() }).eq("payment_provider", "paystack").eq("provider_reference", reference);
    return respond({ error: error?.message || "Checkout initialization failed", orderId: orderId || null }, 500);
  }
});
