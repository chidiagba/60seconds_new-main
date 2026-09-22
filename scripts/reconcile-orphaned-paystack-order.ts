import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const main = async () => {
const reference = process.argv.find((_, i, a) => a[i - 1] === '--reference') || '';
const apply = process.argv.includes('--apply');
if (!reference) throw new Error('Usage: --reference <paystack-reference> [--apply]');
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const paystackKey = process.env.PAYSTACK_SECRET_KEY || '';
if (!url || !serviceKey || !paystackKey) throw new Error('Missing Supabase URL/service role or Paystack secret.');
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${paystackKey}` } });
const verified = await response.json() as any;
const payment = verified?.data;
if (!response.ok || verified?.status !== true || payment?.status !== 'success') throw new Error('Paystack transaction is not successful.');
const metadata = payment.metadata || {};
const productId = String(metadata.productId || '').trim();
const ownerId = String(metadata.ownerId || metadata.organizerId || '').trim();
if (!productId || !ownerId) throw new Error('Ambiguous transaction: product/owner metadata is missing.');
const { data: product, error: productError } = await admin.from('products').select('*').eq('id', productId).single();
if (productError || !product || product.business_id !== ownerId) throw new Error('Product ownership does not match Paystack metadata.');
const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
const buyer = users.data.users.find((user) => user.email?.toLowerCase() === String(payment.customer?.email || '').toLowerCase());
if (!buyer) throw new Error('Buyer email cannot be resolved unambiguously.');
const [{ data: ledger }, { data: existingPayment }, { data: existingOrder }] = await Promise.all([
  admin.from('transactions').select('id,metadata').eq('metadata->>payment_reference', reference),
  admin.from('payments').select('id,order_id').eq('payment_provider', 'paystack').eq('provider_reference', reference),
  admin.from('orders').select('id').eq('payment_provider', 'paystack').eq('payment_reference', reference),
]);
const audit = { reference, amount: Number(payment.amount) / 100, currency: payment.currency, buyerId: buyer.id, ownerId, productId,
  ledgerRows: ledger?.length || 0, paymentRows: existingPayment?.length || 0, orderRows: existingOrder?.length || 0, apply };
console.log(JSON.stringify(audit, null, 2));
if (!apply) process.exit(0);
if ((existingPayment?.length || 0) > 1 || (existingOrder?.length || 0) > 1) throw new Error('Ambiguous existing records; refusing repair.');
let orderId = existingOrder?.[0]?.id || existingPayment?.[0]?.order_id;
const gross = Number(payment.amount) / 100;
const net = Number((gross / 1.04).toFixed(2));
const fee = Number((gross - net).toFixed(2));
if (!orderId) {
  const inserted = await admin.from('orders').insert({ user_id: buyer.id, business_id: ownerId, event_id: product.event_id,
    video_id: metadata.videoId || null, total_amount: gross, subtotal: net, platform_fee: fee, currency: payment.currency,
    status: 'pending', payment_status: 'pending', payment_method: 'paystack', payment_provider: 'paystack', payment_reference: reference,
    source: 'paystack_orphan_reconciliation', items: [{ product_id: product.id, quantity: 1, price: net, name: product.name, type: product.type, currency: payment.currency }],
    payment_metadata: { reconciled_from_legacy: true } }).select('*').single();
  if (inserted.error) throw inserted.error;
  orderId = inserted.data.id;
}
// Link legacy rows before changing order/payment status. Production's existing
// paid-order ledger trigger keys by order_id; doing this first makes it reuse
// the already-credited entry instead of attempting a second credit.
for (const tx of ledger || []) {
  const { error: linkError } = await admin.from('transactions').update({
    metadata: { ...(tx.metadata || {}), order_id: orderId, owner_id: ownerId, buyer_id: buyer.id,
      legacy_unlinked_payment: false, reconciled_at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  }).eq('id', tx.id);
  if (linkError) throw linkError;
}
await admin.from('payments').upsert({ order_id: orderId, user_id: buyer.id, organizer_id: ownerId, payment_provider: 'paystack',
  provider_reference: reference, gateway_reference: reference, amount: gross, currency: payment.currency, status: 'pending',
  processing_fee: fee, net_amount: net, metadata: { reconciled_from_legacy: true } }, { onConflict: 'payment_provider,provider_reference' });
payment.metadata = { ...metadata, orderId, orderNumber: null, buyerId: buyer.id, userId: buyer.id, organizerId: ownerId, ownerId,
  productId, items: [{ productId, quantity: 1, unitPrice: net, currency: payment.currency }], paymentType: 'order_payment' };
const raw = JSON.stringify({ event: 'charge.success', data: payment });
const signature = crypto.createHmac('sha512', paystackKey).update(raw).digest('hex');
const webhook = await fetch(`${url}/functions/v1/paystack-webhook-settlement`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature }, body: raw });
const result = await webhook.json();
if (!webhook.ok || !result?.success) throw new Error(`Webhook finalization failed: ${JSON.stringify(result)}`);
console.log(JSON.stringify({ success: true, orderId, result }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
