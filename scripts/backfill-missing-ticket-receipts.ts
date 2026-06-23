import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createOrderNumber = (orderId: string, createdAt?: string | null) => {
  const stamp = createdAt ? new Date(createdAt).getTime() : Date.now();
  return `ORD-${stamp}-${String(orderId || '').slice(0, 6)}`;
};

const toSourceItems = (order: any) => {
  const rawItems = Array.isArray(order?.items) ? order.items : [];
  return rawItems
    .map((item: any) => {
      const productId = String(item?.product_id || item?.productId || '').trim();
      if (!productId) return null;
      return {
        productId,
        name: String(item?.name || item?.product_name || 'Ticket').trim() || 'Ticket',
        quantity: Math.max(1, Number(item?.quantity || 1)),
        unitPrice: Number(item?.price || item?.unit_price || 0),
        currency: item?.currency ? String(item.currency).toUpperCase() : undefined,
        type: String(item?.type || 'ticket').toLowerCase(),
        videoId: order?.video_id || undefined,
      };
    })
    .filter(Boolean) as Array<{
      productId: string;
      name: string;
      quantity: number;
      unitPrice: number;
      currency?: string;
      type?: string;
      videoId?: string;
    }>;
};

const resolveOrderRows = async () => {
  const withPaymentStatus = await supabaseAdmin
    .from('orders')
    .select('id,user_id,video_id,event_id,items,status,payment_status,created_at,order_number')
    .order('created_at', { ascending: true });

  if (!withPaymentStatus.error) return withPaymentStatus.data || [];

  const fallback = await supabaseAdmin
    .from('orders')
    .select('id,user_id,video_id,event_id,items,status,created_at')
    .order('created_at', { ascending: true });

  if (fallback.error) {
    throw new Error(`Failed to load orders: ${fallback.error.message}`);
  }

  return fallback.data || [];
};

const run = async () => {
  const orders = await resolveOrderRows();

  const { data: existingReceipts, error: existingReceiptsError } = await supabaseAdmin
    .from('ticket_receipts')
    .select('order_id');

  if (existingReceiptsError) {
    throw new Error(`Failed to load existing receipts: ${existingReceiptsError.message}`);
  }

  const existingOrderIds = new Set((existingReceipts || []).map((row: any) => row.order_id));

  let createdOrders = 0;
  let createdTickets = 0;
  let skipped = 0;

  for (const order of orders) {
    const normalizedStatus = String(order?.status || '').trim().toLowerCase();
    const normalizedPaymentStatus = String((order as any)?.payment_status || '').trim().toLowerCase();

    const paid =
      normalizedStatus === 'completed' ||
      normalizedStatus === 'paid' ||
      normalizedStatus === 'success' ||
      normalizedPaymentStatus === 'paid' ||
      normalizedPaymentStatus === 'completed' ||
      normalizedPaymentStatus === 'success';

    if (!paid) {
      skipped += 1;
      continue;
    }

    if (existingOrderIds.has(order.id)) {
      skipped += 1;
      continue;
    }

    const items = toSourceItems(order);
    if (!items.length) {
      skipped += 1;
      continue;
    }

    const productIds = Array.from(new Set(items.map((item) => item.productId)));
    const { data: products, error: productsError } = await supabaseAdmin
      .from('products')
      .select('id,business_id,event_id,type,name,price,currency')
      .in('id', productIds);

    if (productsError) {
      throw new Error(`Failed to resolve products for order ${order.id}: ${productsError.message}`);
    }

    const productById = new Map((products || []).map((p: any) => [p.id, p]));

    const eventIds = Array.from(new Set((products || []).map((p: any) => p.event_id).filter(Boolean)));
    const { data: events, error: eventsError } = eventIds.length
      ? await supabaseAdmin
          .from('events')
          .select('id,user_id,event_name,start_date,end_date,location_name,video_id')
          .in('id', eventIds)
      : { data: [], error: null };

    if (eventsError) {
      throw new Error(`Failed to resolve events for order ${order.id}: ${eventsError.message}`);
    }

    const eventsById = new Map((events || []).map((e: any) => [e.id, e]));
    const nowIso = new Date().toISOString();
    const rows: any[] = [];
    let serial = 1;

    const orderNumber =
      String((order as any)?.order_number || '').trim() ||
      createOrderNumber(order.id, order.created_at);

    for (const item of items) {
      const product = productById.get(item.productId);
      const event = product?.event_id ? eventsById.get(product.event_id) : null;
      const ownerId = product?.business_id || event?.user_id || null;
      if (!ownerId) continue;

      for (let i = 0; i < item.quantity; i += 1) {
        const seatNo = `A${serial.toString().padStart(2, '0')}`;
        const qrCodeData = `TICKET:${orderNumber}:${item.productId}:${serial}:${Date.now()}`;

        rows.push({
          order_id: order.id,
          order_number: orderNumber,
          buyer_id: order.user_id,
          owner_id: ownerId,
          video_id: event?.video_id || item.videoId || order.video_id || null,
          event_id: product?.event_id || order.event_id || null,
          product_id: item.productId,
          ticket_type: item.type || product?.type || 'ticket',
          ticket_title: item.name || product?.name || 'Ticket',
          quantity: 1,
          unit_price: Number(item.unitPrice || product?.price || 0),
          total_price: Number(item.unitPrice || product?.price || 0),
          currency: item.currency || product?.currency || 'USD',
          qr_code_data: qrCodeData,
          seat_no: seatNo,
          event_name: event?.event_name || '60seconds Event',
          event_start_date: event?.start_date || null,
          event_end_date: event?.end_date || null,
          location_name: event?.location_name || 'Location not specified',
          is_active: true,
          issued_at: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
        });
        serial += 1;
      }
    }

    if (!rows.length) {
      skipped += 1;
      continue;
    }

    const { error: insertError } = await supabaseAdmin
      .from('ticket_receipts')
      .insert(rows);

    if (insertError) {
      throw new Error(`Failed to insert ticket receipts for order ${order.id}: ${insertError.message}`);
    }

    createdOrders += 1;
    createdTickets += rows.length;
    existingOrderIds.add(order.id);
    console.log(`Backfilled ${rows.length} ticket receipt(s) for order ${order.id}`);
  }

  console.log(`Ticket backfill complete. Orders updated: ${createdOrders}, tickets inserted: ${createdTickets}, skipped: ${skipped}`);
};

run().catch((error) => {
  console.error('backfill-missing-ticket-receipts failed:', error);
  process.exit(1);
});
