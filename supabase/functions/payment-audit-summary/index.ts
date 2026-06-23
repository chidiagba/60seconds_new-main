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
  `https://${Deno.env.get("SUPABASE_PROJECT_REF") || ""}.supabase.co`;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const backfillAdminToken = Deno.env.get("BACKFILL_ADMIN_TOKEN") || "";

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing Supabase environment for payment-audit-summary");
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req) => {
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

    const { data: recentOrders, error: ordersError } = await supabaseAdmin
      .from("orders")
      .select("id,user_id,business_id,total_amount,status,payment_method,created_at,items")
      .order("created_at", { ascending: false })
      .limit(20);

    if (ordersError) {
      throw new Error(`Failed to fetch orders: ${ordersError.message}`);
    }

    const orderIds = (recentOrders || []).map((row: any) => row.id);

    const { data: ownerCredits, error: ownerCreditsError } = orderIds.length
      ? await supabaseAdmin
          .from("transactions")
          .select("id,amount,wallet_id,metadata,created_at")
          .eq("metadata->>entry", "owner_credit")
          .in("metadata->>order_id", orderIds)
      : { data: [], error: null };

    if (ownerCreditsError) {
      throw new Error(`Failed to fetch owner credits: ${ownerCreditsError.message}`);
    }

    const { data: receipts, error: receiptsError } = orderIds.length
      ? await supabaseAdmin
          .from("ticket_receipts")
          .select("id,order_id,product_id,buyer_id,owner_id,issued_at")
          .in("order_id", orderIds)
      : { data: [], error: null };

    if (receiptsError) {
      throw new Error(`Failed to fetch ticket receipts: ${receiptsError.message}`);
    }

    const productIds = Array.from(
      new Set(
        (recentOrders || [])
          .flatMap((order: any) => (Array.isArray(order.items) ? order.items : []))
          .map((item: any) => String(item?.product_id || "").trim())
          .filter(Boolean)
      )
    );

    const { data: products, error: productsError } = productIds.length
      ? await supabaseAdmin
          .from("products")
          .select("id,name,available_quantity,sold_quantity,updated_at")
          .in("id", productIds)
      : { data: [], error: null };

    if (productsError) {
      throw new Error(`Failed to fetch product stock: ${productsError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        totals: {
          ordersExamined: (recentOrders || []).length,
          ownerCreditRows: (ownerCredits || []).length,
          ticketReceiptRows: (receipts || []).length,
          productsExamined: (products || []).length,
        },
        recentOrders: recentOrders || [],
        ownerCredits: ownerCredits || [],
        ticketReceipts: receipts || [],
        productStock: products || [],
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || "Unknown audit error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
