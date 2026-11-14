// @ts-nocheck
import { corsForRequest } from '../_shared/cors.ts';
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";



const supabaseUrl =
  Deno.env.get("SUPABASE_URL") ||
  `https://${Deno.env.get("SUPABASE_PROJECT_REF") || ""}.supabase.co`;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const backfillAdminToken = Deno.env.get("BACKFILL_ADMIN_TOKEN") || "";

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing Supabase environment for paystack-routing-audit");
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

    let rows: any[] = [];
    let { data: fullRows, error: fullError } = await supabaseAdmin
      .from("business_bank_accounts")
      .select("id,user_id,is_active,is_verified,verification_status,payout_provider,country_code,paystack_subaccount_code,paystack_recipient_code,paystack_subaccount_id,paystack_recipient_id,metadata,updated_at")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(100);

    if (!fullError) {
      rows = fullRows || [];
    } else {
      const { data: fallbackRows, error: fallbackError } = await supabaseAdmin
        .from("business_bank_accounts")
        .select("id,user_id,is_active,is_verified,verification_status,payout_provider,country_code,metadata,updated_at")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(100);

      if (!fallbackError) {
        rows = fallbackRows || [];
      } else {
        const { data: minimalRows, error: minimalError } = await supabaseAdmin
          .from("business_bank_accounts")
          .select("id,user_id,is_active,is_verified,verification_status,payout_provider,country_code,updated_at")
          .eq("is_active", true)
          .order("updated_at", { ascending: false })
          .limit(100);

        if (minimalError) {
          throw new Error(`Failed to query bank accounts: ${minimalError.message}`);
        }

        rows = minimalRows || [];
      }
    }

    const paystackRows = (rows || []).filter((row: any) => {
      const provider = String(row?.payout_provider || "").toLowerCase();
      const country = String(row?.country_code || "").toUpperCase();
      return provider === "paystack" || country === "NG";
    });

    const readiness = paystackRows.map((row: any) => {
      const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const subaccountCode = row.paystack_subaccount_code || metadata.paystack_subaccount_code || metadata.paystackSubaccountCode || "";
      const recipientCode = row.paystack_recipient_code || metadata.paystack_recipient_code || metadata.paystackRecipientCode || "";
      const subaccountId = row.paystack_subaccount_id || metadata.paystack_subaccount_id || metadata.paystackSubaccountId || "";
      const recipientId = row.paystack_recipient_id || metadata.paystack_recipient_id || metadata.paystackRecipientId || "";

      return {
        id: row.id,
        user_id: row.user_id,
        payout_provider: row.payout_provider,
        country_code: row.country_code,
        is_verified: row.is_verified,
        verification_status: row.verification_status,
        has_subaccount_code: !!String(subaccountCode).trim(),
        has_recipient_code: !!String(recipientCode).trim(),
        has_subaccount_id: !!String(subaccountId).trim(),
        has_recipient_id: !!String(recipientId).trim(),
        updated_at: row.updated_at,
      };
    });

    return new Response(
      JSON.stringify({
        success: true,
        totalActiveRows: (rows || []).length,
        paystackRelatedRows: paystackRows.length,
        readiness,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: 'Request could not be completed' }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
