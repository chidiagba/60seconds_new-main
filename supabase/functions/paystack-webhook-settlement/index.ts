// @ts-nocheck
import { logger } from '../_shared/logger.ts';
import { corsForRequest } from '../_shared/cors.ts';
import { reconcileGuestPaystack } from '../_shared/guest-paystack.ts';
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";



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

const roundMoney = (value: number) => Number(Number(value || 0).toFixed(2));

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const verifySignature = async (rawBody: string, signatureHeader: string | null) => {
  if (!paystackSecretKey || !signatureHeader || !/^[a-f0-9]{128}$/i.test(signatureHeader)) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(paystackSecretKey),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );

  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = toHex(digest);
  let mismatch = 0;
  const supplied = signatureHeader.toLowerCase();
  for (let index = 0; index < expected.length; index++) mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  return mismatch === 0;
};

const settleWalletFunding = async (data: any, metadata: any) => {
  const { data: result, error } = await supabaseAdmin.rpc('finalize_paystack_wallet_funding', {
    target_user: metadata?.userId || metadata?.user_id,
    payment_reference: String(data?.reference || ''),
    payment_transaction_id: String(data?.id || ''),
    amount: roundMoney(Number(data?.amount || 0) / 100),
    currency: String(data?.currency || 'NGN').toUpperCase(),
  });
  if (error) throw error;
  return result;
};

const settleOrderPayment = async (data: any, metadata: any) => {
  const paymentReference = String(data?.reference || "").trim() || null;
  let orderId = String(metadata?.orderId || metadata?.order_id || "").trim();
  if (paymentReference) {
    const { data: paymentRow, error: paymentLookupError } = await supabaseAdmin
      .from("payments").select("id,order_id,user_id,organizer_id,amount,currency,status")
      .eq("payment_provider", "paystack").eq("provider_reference", paymentReference).maybeSingle();
    if (paymentLookupError) throw new Error(`Payment lookup failed: ${paymentLookupError.message}`);
    orderId = orderId || String(paymentRow?.order_id || "").trim();
  }
  if (!orderId) {
    throw new Error("Missing orderId in Paystack metadata.");
  }

  const {data:order,error:orderError}=await supabaseAdmin.from('orders').select('id,payment_metadata').eq('id',orderId).single();
  if(orderError||!order)throw new Error('Order not found');
  if(order.payment_metadata?.checkout_version!=='voucher_v2')return {success:false,requiresReconciliation:true,orderId};
  const {data:completed,error}=await supabaseAdmin.rpc('finalize_checkout_payment',{
    order_key:order.id,provider:'paystack',reference:paymentReference,
    paid_amount:Number(data.amount)/100,paid_currency:data.currency,transaction_key:String(data.id),
  });
  if(error)throw error;
  return {success:true,orderId:completed.id};
};

Deno.serve(async (req) => {
  const corsHeaders = corsForRequest(req);
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

    return new Response(JSON.stringify({ success: !result?.requiresReconciliation, event, result }), {
      status: result?.requiresReconciliation ? 503 : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("paystack-webhook-settlement error:", error);
    return new Response(JSON.stringify({ error: 'Request could not be completed' }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
