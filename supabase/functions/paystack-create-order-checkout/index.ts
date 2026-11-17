// @ts-nocheck
import { logger } from '../_shared/logger.ts';
import { corsForRequest } from '../_shared/cors.ts';
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const paystackKey = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const auth = createClient(url, anonKey, { auth: { persistSession: false } });

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
  const cors = corsForRequest(req);
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let orderId = "";
  let reference = "";
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    if (authError || !authData.user) return respond({ error: "Authentication required" }, 401);
    const body = await req.json().catch(() => ({}));
    const allowedChannels = ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer'];
    if (body.channels !== undefined && (!Array.isArray(body.channels) || !body.channels.length || body.channels.some((channel: unknown) => !allowedChannels.includes(String(channel))))) {
      return respond({error:'Invalid payment method'},400);
    }
    const requestedChannels = Array.isArray(body.channels) ? [...new Set(body.channels)].sort() : null;
    const requested = Array.isArray(body.items) ? body.items : [];
    if (!requested.length) return respond({ error: "At least one product is required" }, 400);
    let voucherCode = String(body.voucherCode || '').trim();
    if (!voucherCode && body.voucherId) {
      const {data: voucher} = await admin.from('vouchers').select('code').eq('id',body.voucherId).single();
      if (!voucher) return respond({error:'Voucher not found'},400);
      voucherCode = voucher.code;
    }
    const {data: order, error: checkoutError} = await admin.rpc('create_order_checkout', {
      requested_items: requested, voucher_code: voucherCode || null,
      request_key: String(body.requestKey || crypto.randomUUID()), provider:'paystack', buyer_key:authData.user.id,
    });
    if (checkoutError || !order) return respond({error:checkoutError?.message || 'Checkout unavailable'},409);
    orderId=order.id; reference=order.payment_reference;
    if (order.payment_status==='paid') return respond({success:true,completed:true,order,payment:{reference,status:'completed'}});
    if (!paystackKey) throw new Error("PAYSTACK_SECRET_KEY is not configured");
    if (order.currency!=='NGN') return respond({error:'Use Stripe for non-NGN purchases'},400);
    const organizerId=order.business_id, currency=order.currency, total=Number(order.total_amount);
    const platformFee=Number(order.platform_fee), subtotal=money(total-platformFee);
    const items=order.items, ids=items.map((item:any)=>item.product_id);
    const {data: previousAttempt}=await admin.from('payments').select('metadata').eq('payment_provider','paystack').eq('provider_reference',reference).maybeSingle();
    if (previousAttempt?.metadata?.authorization_url) {
      if (JSON.stringify(previousAttempt.metadata.checkout_channels || null) !== JSON.stringify(requestedChannels)) {
        return respond({error:'The previous checkout uses a different payment method. Return to that method or check its status in Orders.'},409);
      }
      return respond({success:true,order,payment:{reference,status:'pending'},authorizationUrl:previousAttempt.metadata.authorization_url,accessCode:previousAttempt.metadata.access_code});
    }
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
    const { error: paymentError } = await admin.from("payments").upsert({
      order_id: order.id, user_id: authData.user.id, organizer_id: organizerId, payment_provider: "paystack",
      provider_reference: reference, gateway_reference: reference, amount: total, currency, status: "pending",
      processing_fee: platformFee, net_amount: subtotal, metadata: { products: ids, voucher_id: order.voucher_id || null },
    }, {onConflict:"payment_provider,provider_reference",ignoreDuplicates:true});
    if (paymentError) throw new Error(`Payment attempt creation failed: ${paymentError.message}`);
    const metadata = { orderId: order.id, orderNumber: order.order_number, buyerId: authData.user.id, userId: authData.user.id, organizerId, ownerId: organizerId, productId: ids[0], items, checkout_channels: requestedChannels, paymentType: "order_payment", splitMode: subaccount ? "single_subaccount" : "platform_collection" };
    const paystackPayload: any = {
      email: authData.user.email, amount: Math.round(total * 100), currency, reference,
      callback_url: `myapp://paystack/callback?reference=${encodeURIComponent(reference)}&orderId=${order.id}`,
      metadata,
      channels: requestedChannels || undefined,
    };
    if (subaccount) {
      paystackPayload.subaccount = subaccount;
      paystackPayload.transaction_charge = Math.round(platformFee * 100);
      paystackPayload.bearer = "account";
    }
    const response = await fetch("https://api.paystack.co/transaction/initialize", { method: "POST", headers: { Authorization: `Bearer ${paystackKey}`, "Content-Type": "application/json" }, body: JSON.stringify(paystackPayload) });
    const initialized = await response.json().catch(() => ({}));
    if (!response.ok || initialized?.status !== true || !initialized?.data?.authorization_url) throw new Error(initialized?.message || "Paystack initialization failed");
    await admin.from("payments").update({ provider_status: "initialized", metadata: { ...metadata, access_code: initialized.data.access_code, authorization_url: initialized.data.authorization_url }, updated_at: new Date().toISOString() }).eq("payment_provider", "paystack").eq("provider_reference", reference);
    logger.debug(JSON.stringify({ event: "paystack_initialized", orderId, reference }));
    return respond({ success: true, order, payment: { reference, status: "pending" }, authorizationUrl: initialized.data.authorization_url, accessCode: initialized.data.access_code });
  } catch (error) {
    console.error(JSON.stringify({ event: "paystack_initialization_failed", orderId, reference, error: 'Request could not be completed' }));
    if (reference) await admin.from("payments").update({ provider_status: "initialization_uncertain", failure_reason: "Initialization requires reconciliation", updated_at: new Date().toISOString() }).eq("payment_provider", "paystack").eq("provider_reference", reference).eq("status", "pending");
    return respond({ error: 'Request could not be completed', orderId: orderId || null }, 500);
  }
});
