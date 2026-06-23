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
  throw new Error("Missing Supabase environment for reconcile-product-stock-from-receipts");
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

    const { data: receipts, error: receiptsError } = await supabaseAdmin
      .from("ticket_receipts")
      .select("product_id");

    if (receiptsError) {
      throw new Error(`Failed to load ticket receipts: ${receiptsError.message}`);
    }

    const soldByProduct = new Map<string, number>();
    for (const row of receipts || []) {
      const productId = String(row?.product_id || "").trim();
      if (!productId) continue;
      soldByProduct.set(productId, (soldByProduct.get(productId) || 0) + 1);
    }

    const productIds = Array.from(soldByProduct.keys());
    if (!productIds.length) {
      return new Response(JSON.stringify({ success: true, updated: 0, skipped: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: products, error: productsError } = await supabaseAdmin
      .from("products")
      .select("id,available_quantity,sold_quantity")
      .in("id", productIds);

    if (productsError) {
      throw new Error(`Failed to load products: ${productsError.message}`);
    }

    let updated = 0;
    let skipped = 0;
    for (const product of products || []) {
      const receiptSold = soldByProduct.get(product.id) || 0;
      const currentSold = Number(product.sold_quantity || 0);
      const currentAvailable = Number(product.available_quantity || 0);

      if (receiptSold <= currentSold) {
        skipped += 1;
        continue;
      }

      const delta = receiptSold - currentSold;
      const nextSold = receiptSold;
      const nextAvailable = Math.max(0, currentAvailable - delta);

      const { error: updateError } = await supabaseAdmin
        .from("products")
        .update({
          sold_quantity: nextSold,
          available_quantity: nextAvailable,
          updated_at: new Date().toISOString(),
        })
        .eq("id", product.id);

      if (updateError) {
        throw new Error(`Failed to update product ${product.id}: ${updateError.message}`);
      }

      updated += 1;
    }

    return new Response(JSON.stringify({ success: true, updated, skipped }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
