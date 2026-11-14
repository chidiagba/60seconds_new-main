// @ts-nocheck
import { corsForRequest } from '../_shared/cors.ts';
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";



const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const orderIdFromMetadata = (metadata: any): string => String(
  metadata?.orderId || metadata?.order_id ||
  (Array.isArray(metadata?.custom_fields)
    ? metadata.custom_fields.find((field: any) => ['orderid', 'order_id'].includes(String(field?.variable_name || '').toLowerCase()))?.value
    : '') || ''
).trim();

const ownerForOrder = async (order: any): Promise<string | null> => {
  if (order?.business_id) return String(order.business_id);
  const ids = Array.from(new Set((Array.isArray(order?.items) ? order.items : [])
    .map((item: any) => item?.product_id || item?.productId || item?.id)
    .filter(Boolean).map(String)));
  if (!ids.length) return null;
  const { data, error } = await admin.from('products').select('id,business_id').in('id', ids);
  if (error) throw new Error(error.message);
  const owners = new Set((data || []).map((product: any) => product.business_id).filter(Boolean).map(String));
  return owners.size === 1 ? Array.from(owners)[0] : null;
};

const buyerIdForPayment = async (payment: any): Promise<string | null> => {
  const metadata = payment?.metadata || {};
  const metadataBuyerId = String(metadata?.userId || metadata?.user_id || '').trim();
  if (metadataBuyerId) return metadataBuyerId;
  const buyerEmail = String(payment?.customer?.email || payment?.email || '').trim().toLowerCase();
  if (!buyerEmail) return null;
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return String((data?.users || []).find((user: any) =>
    String(user?.email || '').trim().toLowerCase() === buyerEmail
  )?.id || '').trim() || null;
};

const settleUnlinkedLegacyPayment = async (payment: any, organizerId: string): Promise<boolean> => {
  const metadata = payment?.metadata || {};
  const metadataOwnerId = String(metadata?.ownerId || metadata?.owner_id || metadata?.recipientId || metadata?.recipient_id || '').trim();
  if (metadataOwnerId !== organizerId) return false;

  const reference = String(payment?.reference || '').trim();
  if (!reference) return false;
  const { data: existing, error: existingError } = await admin.from('transactions')
    .select('id')
    .eq('metadata->>entry', 'owner_credit')
    .eq('metadata->>payment_provider', 'paystack')
    .eq('metadata->>payment_reference', reference)
    .limit(1);
  if (existingError) throw new Error(existingError.message);
  if ((existing || []).length) return true;

  const grossAmount = Number((Number(payment?.amount || 0) / 100).toFixed(2));
  if (!(grossAmount > 0)) return false;
  const netAmount = Number((grossAmount / 1.04).toFixed(2));
  const platformFeeAmount = Number((grossAmount - netAmount).toFixed(2));
  const paidAtCandidate = payment?.paid_at || payment?.paidAt || payment?.created_at;
  const paidAt = paidAtCandidate && !Number.isNaN(Date.parse(String(paidAtCandidate)))
    ? new Date(String(paidAtCandidate)).toISOString()
    : new Date().toISOString();
  const buyerId = await buyerIdForPayment(payment);
  const itemName = String(metadata?.ticketName || metadata?.ticket_name || metadata?.eventName || metadata?.event_name || metadata?.productName || metadata?.product_name || 'Ticket purchase');
  const items = Array.isArray(metadata?.items) && metadata.items.length
    ? metadata.items
    : [{ name: itemName, quantity: 1, totalPrice: netAmount, currency: payment?.currency || 'NGN' }];

  const { data: ownerWallet, error: ownerWalletError } = await admin.from('wallets').upsert({
    user_id: organizerId,
    is_verified: true,
    is_active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' }).select('id').single();
  if (ownerWalletError || !ownerWallet) throw new Error(ownerWalletError?.message || 'Owner wallet unavailable');

  const sharedMetadata = {
    payment_provider: 'paystack',
    owner_id: organizerId,
    buyer_id: buyerId,
    payment_reference: reference,
    payment_transaction_id: String(payment?.id || reference),
    gross_amount: grossAmount,
    platform_fee_amount: platformFeeAmount,
    net_amount: netAmount,
    currency: String(payment?.currency || 'NGN').toUpperCase(),
    items,
    legacy_unlinked_payment: true,
  };
  const { error: ownerTxError } = await admin.from('transactions').insert({
    wallet_id: ownerWallet.id,
    amount: netAmount,
    type: 'deposit',
    status: 'completed',
    description: 'Ticket sale',
    transaction_fee: 0,
    metadata: { ...sharedMetadata, entry: 'owner_credit', lifecycle_stage: 'in_paystack_subaccount' },
    created_at: paidAt,
    updated_at: new Date().toISOString(),
  });
  if (ownerTxError) throw new Error(ownerTxError.message);

  if (buyerId) {
    const { data: buyerWallet } = await admin.from('wallets').upsert({
      user_id: buyerId, is_active: true, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' }).select('id').single();
    if (buyerWallet?.id) await admin.from('transactions').insert({
      wallet_id: buyerWallet.id,
      amount: -grossAmount,
      type: 'payment',
      status: 'completed',
      description: 'Paystack ticket purchase',
      transaction_fee: platformFeeAmount,
      metadata: { ...sharedMetadata, entry: 'buyer_debit' },
      created_at: paidAt,
      updated_at: new Date().toISOString(),
    });
  }
  return true;
};

const resolveLegacyOrder = async (payment: any, organizerId: string): Promise<any | null> => {
  const metadata = payment?.metadata || {};
  const metadataOwnerId = String(metadata?.ownerId || metadata?.owner_id || metadata?.recipientId || metadata?.recipient_id || '').trim();
  let buyerId = String(metadata?.userId || metadata?.user_id || '').trim();
  if (metadataOwnerId !== organizerId) return null;

  if (!buyerId) {
    const buyerEmail = String(payment?.customer?.email || payment?.email || '').trim().toLowerCase();
    if (buyerEmail) {
      const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (usersError) throw new Error(usersError.message);
      buyerId = String((usersPage?.users || []).find((user: any) =>
        String(user?.email || '').trim().toLowerCase() === buyerEmail
      )?.id || '').trim();
    }
  }

  const originalAmount = Number(metadata?.grossAmount ?? metadata?.gross_amount ?? metadata?.original_amount ?? 0);
  const chargedAmount = Number(payment?.amount || 0) / 100;
  const candidateOrderAmounts = Array.from(new Set([
    originalAmount,
    chargedAmount,
    chargedAmount > 0 ? Number((chargedAmount / 1.04).toFixed(2)) : 0,
  ].filter((amount) => amount > 0)));
  if (!candidateOrderAmounts.length) return null;
  const paidAt = new Date(payment?.paid_at || payment?.paidAt || payment?.created_at || Date.now());
  // Legacy checkout could create the cart/order well before the buyer completed
  // Paystack authorization. Buyer email recovery makes this wider window safe,
  // while owner, amount and a single unambiguous match remain mandatory.
  const from = new Date(paidAt.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(paidAt.getTime() + 24 * 60 * 60 * 1000).toISOString();
  let orderQuery = admin.from('orders')
    .select('id,user_id,business_id,total_amount,video_id,event_id,items,created_at')
    .gte('created_at', from)
    .lte('created_at', to);
  if (buyerId) orderQuery = orderQuery.eq('user_id', buyerId);
  const { data, error } = await orderQuery;
  if (error) throw new Error(error.message);

  const matches: any[] = [];
  for (const order of data || []) {
    const orderAmount = Number(order.total_amount || 0);
    if (!candidateOrderAmounts.some((amount) => Math.abs(orderAmount - amount) <= 0.01)) continue;
    if (await ownerForOrder(order) === organizerId) matches.push(order);
  }
  return matches.length === 1 ? matches[0] : null;
};

Deno.serve(async (req) => {
  const corsHeaders = corsForRequest(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData?.user) throw new Error('Unauthorized');
    if (!paystackSecretKey) throw new Error('PAYSTACK_SECRET_KEY is not configured');

    const body = await req.json().catch(() => ({}));
    const days = Math.min(90, Math.max(1, Number(body?.days || 45)));
    const from = new Date(Date.now() - days * 86400000).toISOString();
    const response = await fetch(`https://api.paystack.co/transaction?status=success&from=${encodeURIComponent(from)}&perPage=100`, {
      headers: { Authorization: `Bearer ${paystackSecretKey}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.status !== true) throw new Error(payload?.message || 'Paystack transaction lookup failed');

    let matched = 0;
    let settled = 0;
    const failures: string[] = [];
    for (const payment of payload?.data || []) {
      let orderId = orderIdFromMetadata(payment?.metadata);
      let order: any = null;
      if (orderId) {
        const result = await admin.from('orders')
          .select('id,user_id,business_id,total_amount,video_id,event_id,items,created_at')
          .eq('id', orderId).maybeSingle();
        order = result.data;
      } else {
        order = await resolveLegacyOrder(payment, authData.user.id);
        orderId = String(order?.id || '');
      }
      if (!order) {
        if (await settleUnlinkedLegacyPayment(payment, authData.user.id)) {
          matched += 1;
          settled += 1;
        }
        continue;
      }
      const ownerId = await ownerForOrder(order);
      if (ownerId !== authData.user.id) continue;
      matched += 1;

      const settlementResponse = await fetch(`${supabaseUrl}/functions/v1/settle-external-order-payment`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderId,
          provider: 'paystack',
          paymentReference: payment.reference,
          paymentTransactionId: String(payment.id || payment.reference),
          grossAmount: Number(payment.amount || 0) / 100,
          currency: payment.currency,
          metadata: {
            ...(payment.metadata || {}),
            paidAt: payment.paid_at || payment.paidAt || payment.created_at || null,
          },
        }),
      });
      const result = await settlementResponse.json().catch(() => ({}));
      if (settlementResponse.ok && result?.success) settled += 1;
      else failures.push(`${orderId}: ${result?.error || 'settlement failed'}`);
    }

    return new Response(JSON.stringify({ success: true, matched, settled, failures }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: 'Request could not be completed' }), {
      status: String(error?.message) === 'Unauthorized' ? 401 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
