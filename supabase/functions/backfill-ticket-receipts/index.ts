// @ts-nocheck
import { corsForRequest } from '../_shared/cors.ts';
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";



const supabaseUrl =
  Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const backfillAdminToken = Deno.env.get("BACKFILL_ADMIN_TOKEN") || "";

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing Supabase environment for backfill-ticket-receipts");
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createOrderNumber = (orderId: string, createdAt?: string | null) => {
  const stamp = createdAt ? new Date(createdAt).getTime() : Date.now();
  return `ORD-${stamp}-${String(orderId || "").slice(0, 6)}`;
};

const resolveOrderRows = async () => {
  const withPaymentStatus = await supabaseAdmin
    .from("orders")
    .select("id,user_id,video_id,event_id,items,status,payment_status,created_at,order_number")
    .order("created_at", { ascending: true });

  if (!withPaymentStatus.error) return withPaymentStatus.data || [];

  const fallback = await supabaseAdmin
    .from("orders")
    .select("id,user_id,video_id,event_id,items,status,created_at")
    .order("created_at", { ascending: true });

  if (fallback.error) {
    throw new Error(`Failed to load orders: ${fallback.error.message}`);
  }

  return fallback.data || [];
};

const toSourceItems = (order: any) => {
  const rawItems = Array.isArray(order?.items) ? order.items : [];
  return rawItems
    .map((item: any) => {
      const productId = String(item?.product_id || item?.productId || "").trim();
      if (!productId) return null;
      return {
        productId,
        name: String(item?.name || item?.product_name || "").trim() || undefined,
        quantity: Math.max(1, Number(item?.quantity || 1)),
        unitPrice: Number(item?.price || item?.unit_price || 0),
        currency: item?.currency ? String(item.currency).toUpperCase() : undefined,
        type: item?.type ? String(item.type).toLowerCase() : undefined,
        videoId: order?.video_id || undefined,
      };
    })
    .filter(Boolean);
};

Deno.serve(async (req) => {
  const corsHeaders = corsForRequest(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.adminToken || "").trim();

    if (!backfillAdminToken || token !== backfillAdminToken) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orders = await resolveOrderRows();

    const { data: existingReceipts, error: existingReceiptsError } = await supabaseAdmin
      .from("ticket_receipts")
      .select("order_id");

    if (existingReceiptsError) {
      throw new Error(`Failed to load existing receipts: ${existingReceiptsError.message}`);
    }

    const existingOrderIds = new Set((existingReceipts || []).map((row: any) => row.order_id));
    let createdOrders = 0;
    let createdTickets = 0;
    let skipped = 0;

    for (const order of orders) {
      const normalizedStatus = String(order?.status || "").trim().toLowerCase();
      const normalizedPaymentStatus = String(order?.payment_status || "").trim().toLowerCase();

      const paid =
        normalizedStatus === "completed" ||
        normalizedStatus === "paid" ||
        normalizedStatus === "success" ||
        normalizedPaymentStatus === "paid" ||
        normalizedPaymentStatus === "completed" ||
        normalizedPaymentStatus === "success";

      if (!paid || existingOrderIds.has(order.id)) {
        skipped += 1;
        continue;
      }

      const items = toSourceItems(order);
      if (!items.length) {
        skipped += 1;
        continue;
      }

      const productIds = Array.from(new Set(items.map((item: any) => item.productId)));
      const { data: products, error: productsError } = await supabaseAdmin
        .from("products")
        .select("id,business_id,event_id,type,name,price,currency")
        .in("id", productIds);

      if (productsError) {
        throw new Error(`Failed to resolve products for order ${order.id}: ${productsError.message}`);
      }

      const productById = new Map((products || []).map((p: any) => [p.id, p]));
      const eventIds = Array.from(new Set((products || []).map((p: any) => p.event_id).filter(Boolean)));
      const { data: events, error: eventsError } = eventIds.length
        ? await supabaseAdmin
            .from("events")
            .select("id,user_id,event_name,start_date,end_date,location_name,video_id")
            .in("id", eventIds)
        : { data: [], error: null };

      if (eventsError) {
        throw new Error(`Failed to resolve events for order ${order.id}: ${eventsError.message}`);
      }

      const eventsById = new Map((events || []).map((e: any) => [e.id, e]));
      const nowIso = new Date().toISOString();
      const rows: any[] = [];
      let serial = 1;

      const orderNumber = String(order?.order_number || "").trim() || createOrderNumber(order.id, order.created_at);

      for (const item of items) {
        const product = productById.get(item.productId);
        const event = product?.event_id ? eventsById.get(product.event_id) : null;
        const ownerId = product?.business_id || event?.user_id || null;
        if (!ownerId) continue;

        const quantity = Math.max(1, Number(item.quantity || 1));
        const receiptType = String(item.type || product?.type || "ticket").toLowerCase();
        const isTicket = receiptType === "ticket";
        const receiptCount = isTicket ? quantity : 1;
        const unitPrice = Number(item.unitPrice || product?.price || 0);

        for (let i = 0; i < receiptCount; i += 1) {
          const receiptQuantity = isTicket ? 1 : quantity;
          const seatNo = isTicket ? `A${serial.toString().padStart(2, "0")}` : null;
          const qrCodeData = `${isTicket ? "TICKET" : "PRODUCT"}:${orderNumber}:${item.productId}:${serial}:${Date.now()}`;

          rows.push({
            order_id: order.id,
            order_number: orderNumber,
            buyer_id: order.user_id,
            owner_id: ownerId,
            video_id: event?.video_id || item.videoId || order.video_id || null,
            event_id: product?.event_id || order.event_id || null,
            product_id: item.productId,
            ticket_type: receiptType,
            receipt_kind: isTicket ? "ticket" : "product",
            ticket_title: item.name || product?.name || (isTicket ? "Ticket" : "Product"),
            quantity: receiptQuantity,
            unit_price: unitPrice,
            total_price: unitPrice * receiptQuantity,
            currency: item.currency || product?.currency || "USD",
            qr_code_data: qrCodeData,
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
        skipped += 1;
        continue;
      }

      const { error: insertError } = await supabaseAdmin.from("ticket_receipts").insert(rows);
      if (insertError) {
        throw new Error(`Failed to insert ticket receipts for order ${order.id}: ${insertError.message}`);
      }

      createdOrders += 1;
      createdTickets += rows.length;
      existingOrderIds.add(order.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        createdOrders,
        createdTickets,
        skipped,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("backfill-ticket-receipts error:", error);
    return new Response(JSON.stringify({ error: 'Request could not be completed' }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
