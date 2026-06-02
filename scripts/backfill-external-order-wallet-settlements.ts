import { createClient } from '@supabase/supabase-js';

type Provider = 'paystack' | 'twint' | 'worldline';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEFAULT_PLATFORM_FEE_RATE = 0.04;

const roundMoney = (value: number) => Number(Number(value || 0).toFixed(2));

const normalizeProvider = (order: any): Provider | null => {
  const value = String(order?.payment_method || '').trim().toLowerCase();
  if (value === 'paystack' || value === 'twint' || value === 'worldline') {
    return value;
  }
  return null;
};

const deriveNetAmount = (_order: any, grossAmount: number) => {
  return roundMoney(grossAmount / (1 + DEFAULT_PLATFORM_FEE_RATE));
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
      .from('events')
      .select('id, user_id')
      .eq('id', order.event_id)
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
    .from('products')
    .select('id, business_id, event_id')
    .in('id', productIds);

  if (productsError) {
    throw new Error(`Failed to resolve products for order ${order.id}: ${productsError.message}`);
  }

  const eventIds = Array.from(
    new Set((products || []).map((product: any) => product.event_id).filter((value: any) => !!value))
  );

  const eventsById = new Map<string, any>();
  if (eventIds.length) {
    const { data: events, error: eventsError } = await supabaseAdmin
      .from('events')
      .select('id, user_id')
      .in('id', eventIds);

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

const alreadySettled = async (orderId: string, provider: Provider) => {
  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('id')
    .eq('metadata->>entry', 'owner_credit')
    .eq('metadata->>order_id', orderId)
    .eq('metadata->>payment_provider', provider)
    .limit(1);

  if (error) {
    throw new Error(`Failed to check settlement for order ${orderId}: ${error.message}`);
  }

  return (data || []).length > 0;
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

  const netAmount = deriveNetAmount(order, grossAmount);
  const platformFeeAmount = roundMoney(Math.max(0, grossAmount - netAmount));
  const firstItemCurrency = Array.isArray(order?.items)
    ? order.items.find((item: any) => item?.currency)?.currency
    : null;
  const currency = String(firstItemCurrency || 'USD').toUpperCase();
  const paymentReference = null;
  const paymentTransactionId = null;
  const nowIso = new Date().toISOString();

  const { data: ownerWallet, error: ownerWalletError } = await supabaseAdmin
    .from('wallets')
    .upsert(
      {
        user_id: ownerId,
        currency,
        is_verified: true,
        is_active: true,
        updated_at: nowIso,
      },
      { onConflict: 'user_id' }
    )
    .select('id, balance')
    .single();

  if (ownerWalletError || !ownerWallet) {
    throw new Error(`Failed to upsert owner wallet for order ${order.id}: ${ownerWalletError?.message || 'unknown'}`);
  }

  const ownerNewBalance = roundMoney(Number(ownerWallet.balance || 0) + netAmount);
  const { error: ownerWalletUpdateError } = await supabaseAdmin
    .from('wallets')
    .update({ balance: ownerNewBalance, updated_at: nowIso })
    .eq('id', ownerWallet.id);

  if (ownerWalletUpdateError) {
    throw new Error(`Failed to update owner wallet for order ${order.id}: ${ownerWalletUpdateError.message}`);
  }

  const transactionItems = (Array.isArray(order.items) ? order.items : []).map((item: any) => ({
    productId: item?.product_id,
    quantity: item?.quantity,
    unitPrice: item?.price,
  }));

  const { error: ownerTxError } = await supabaseAdmin.from('transactions').insert({
    wallet_id: ownerWallet.id,
    amount: netAmount,
    type: 'deposit',
    status: 'completed',
    description: `${provider === 'paystack' ? 'Paystack' : provider === 'twint' ? 'Twint' : 'Worldline'} sale settlement (backfill)`,
    transaction_fee: 0,
    metadata: {
      entry: 'owner_credit',
      payment_provider: provider,
      owner_id: ownerId,
      buyer_id: order.user_id,
      order_id: order.id,
      video_id: order.video_id || null,
      payment_reference: paymentReference,
      payment_transaction_id: paymentTransactionId,
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

  const { data: buyerWallet } = await supabaseAdmin
    .from('wallets')
    .upsert(
      {
        user_id: order.user_id,
        currency,
        is_active: true,
        updated_at: nowIso,
      },
      { onConflict: 'user_id' }
    )
    .select('id')
    .single();

  if (buyerWallet?.id) {
    await supabaseAdmin.from('transactions').insert({
      wallet_id: buyerWallet.id,
      amount: -grossAmount,
      type: 'payment',
      status: 'completed',
      description: `${provider === 'paystack' ? 'Paystack' : provider === 'twint' ? 'Twint' : 'Worldline'} purchase (backfill)`,
      transaction_fee: platformFeeAmount,
      metadata: {
        entry: 'buyer_debit',
        payment_provider: provider,
        order_id: order.id,
        owner_id: ownerId,
        payment_reference: paymentReference,
        payment_transaction_id: paymentTransactionId,
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
  }

  const { error: orderUpdateError } = await supabaseAdmin
    .from('orders')
    .update({
      business_id: ownerId,
      status: 'completed',
      updated_at: nowIso,
    })
    .eq('id', order.id);

  if (orderUpdateError) {
    throw new Error(`Failed to update order ${order.id}: ${orderUpdateError.message}`);
  }

  return {
    orderId: order.id,
    ownerId,
    grossAmount,
    netAmount,
    platformFeeAmount,
  };
};

const run = async () => {
  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select('id, user_id, business_id, total_amount, video_id, event_id, items, payment_method, status, created_at')
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load orders: ${error.message}`);
  }

  const providerCandidates = (orders || []).filter((order) => normalizeProvider(order));
  const candidateOrderIds = providerCandidates.map((order) => order.id);
  const { data: ticketReceipts, error: ticketReceiptsError } = candidateOrderIds.length
    ? await supabaseAdmin
        .from('ticket_receipts')
        .select('order_id')
        .in('order_id', candidateOrderIds)
    : { data: [], error: null };

  if (ticketReceiptsError) {
    throw new Error(`Failed to load ticket receipts: ${ticketReceiptsError.message}`);
  }

  const paidOrderIds = new Set((ticketReceipts || []).map((receipt: any) => receipt.order_id));
  const candidates = providerCandidates.filter((order) => {
    const normalizedStatus = String(order.status || '').trim().toLowerCase();
    return normalizedStatus === 'completed' || normalizedStatus === 'success' || normalizedStatus === 'paid' || paidOrderIds.has(order.id);
  });
  let settledCount = 0;
  let skippedCount = 0;

  for (const order of candidates) {
    const provider = normalizeProvider(order);
    if (!provider) {
      skippedCount += 1;
      continue;
    }

    if (await alreadySettled(order.id, provider)) {
      skippedCount += 1;
      console.log(`Skipping already settled order ${order.id} (${provider}).`);
      continue;
    }

    const result = await settleOrder(order, provider);
    settledCount += 1;
    console.log(`Settled order ${result.orderId} for owner ${result.ownerId}: gross=${result.grossAmount} net=${result.netAmount}`);
  }

  console.log(`Backfill complete. Settled ${settledCount} order(s), skipped ${skippedCount}.`);
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});