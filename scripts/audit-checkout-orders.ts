/** Read-only audit of ALL orders. Never repairs or updates production records.
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured outside chat.
 * Run: npx tsx scripts/audit-checkout-orders.ts > /private/tmp/checkout-audit.json
 */
import { createClient } from '@supabase/supabase-js';

async function main() {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY locally. Audit is read-only.');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  async function read(table: string, columns: string) {
    const rows: any[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db.from(table).select(columns).order(table === 'voucher_redemptions' ? 'order_id' : 'id').range(offset, offset + 499);
      if (error) throw new Error(`Cannot audit ${table}: ${error.message}`);
      rows.push(...(data || []));
      if (!data || data.length < 500) return rows;
    }
  }
  const [orders, receipts, redemptions, payments, vouchers] = await Promise.all([
    read('orders', 'id,order_number,created_at,total_amount,currency,payment_status,status,payment_provider,payment_reference,voucher_id,discount_amount,payment_metadata,items'),
    read('ticket_receipts', 'id,order_id,receipt_kind,quantity,is_active'),
    read('voucher_redemptions', 'order_id,voucher_id'),
    read('payments', 'id,order_id,payment_provider,status,amount,currency,provider_reference'),
    read('vouchers', 'id,code,usage_count,usage_limit'),
  ]);
  const group = (rows: any[]) => {
    const grouped = new Map<string, any[]>();
    for (const row of rows) grouped.set(row.order_id, [...(grouped.get(row.order_id) || []), row]);
    return grouped;
  };
  const tickets = group(receipts), uses = group(redemptions), attempts = group(payments);
  const findings = orders.map(order => {
    const issued = tickets.get(order.id) || [], redeemed = uses.get(order.id) || [], payment = attempts.get(order.id) || [];
    const problems: string[] = [];
    const paid = order.payment_status === 'paid';
    const expected = (Array.isArray(order.items) ? order.items : []).reduce((n: number, item: any) => n + (item.type === 'ticket' ? Number(item.quantity || 1) : 1), 0);
    if (paid && issued.length !== expected) problems.push('paid_entitlement_count_mismatch');
    if (!paid && issued.some(row => row.is_active)) problems.push('unsettled_order_has_active_entitlement');
    if (paid && order.voucher_id && redeemed.length !== 1) problems.push('paid_voucher_redemption_mismatch');
    if (!paid && redeemed.length) problems.push('unsettled_order_has_redemption');
    if (payment.some(row => row.status === 'completed') && !paid) problems.push('completed_payment_pending_order');
    if (order.payment_status === 'pending' && new Date(order.created_at).getTime() < Date.now() - 30 * 60 * 1000) problems.push('stale_pending_requires_gateway_verification');
    if (paid && Number(order.total_amount) > 0 && !order.payment_reference) problems.push('paid_order_missing_provider_reference');
    return { orderId: order.id, orderNumber: order.order_number, paymentStatus: order.payment_status, orderStatus: order.status,
      amount: order.total_amount, currency: order.currency, provider: order.payment_provider,
      hasProviderReference: Boolean(order.payment_reference), voucherId: order.voucher_id,
      expectedEntitlements: expected, entitlementCount: issued.length, redemptionCount: redeemed.length,
      problems, recovery: problems.length ? 'Verify immutable voucher, pricing, gateway and inventory evidence before any authorized repair' : null };
  });
  const voucherFindings = vouchers.map(voucher => {
    const recorded = redemptions.filter(row => row.voucher_id === voucher.id).length;
    return { voucherId: voucher.id, code: voucher.code, usageCount: voucher.usage_count, recordedRedemptions: recorded,
      usageLimit: voucher.usage_limit, mismatch: Number(voucher.usage_count || 0) !== recorded };
  });
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), readOnly: true, ordersScanned: orders.length,
    flaggedOrders: findings.filter(row => row.problems.length),
    requestedOrder: findings.find(row => String(row.orderNumber).replace(/[^0-9]/g, '').replace(/^0+/, '') === '19') || null,
    voucherFindings: voucherFindings.filter(row => row.mismatch || row.code === 'HJSDGUBY'),
    note: 'Database payment status alone does not prove a gateway charge. No production data was modified.' }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Audit failed'); process.exitCode = 1; });
