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
  throw new Error("Missing Supabase environment for repair-single-external-settlement");
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Provider = "paystack" | "twint" | "worldline";

const DEFAULT_PLATFORM_FEE_RATE = 0.04;
const roundMoney = (value: number) => Number(Number(value || 0).toFixed(2));

const normalizeProvider = (value: any): Provider => {
  const provider = String(value || "").trim().toLowerCase();
  if (provider === "paystack" || provider === "twint" || provider === "worldline") {
    return provider;
  }
  return "paystack";
};

const deriveNetAmount = (grossAmount: number) => roundMoney(grossAmount / (1 + DEFAULT_PLATFORM_FEE_RATE));

const ensureWallet = async (userId: string, currency: string, isVerified = true) => {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("wallets")
    .upsert(
      {
        user_id: userId,
        currency,
        is_verified: isVerified,
        is_active: true,
        updated_at: nowIso,
      },
      { onConflict: "user_id" }
    )
    .select("id,user_id,balance,currency")
    .single();

  if (error || !data) {
    throw new Error(`Failed to ensure wallet for user ${userId}: ${error?.message || "unknown"}`);
  }

  return data;
};

const adjustWalletBalance = async (walletId: string, delta: number) => {
  const { data: wallet, error: fetchError } = await supabaseAdmin
    .from("wallets")
    .select("id,balance")
    .eq("id", walletId)
    .single();

  if (fetchError || !wallet) {
    throw new Error(`Failed to fetch wallet ${walletId}: ${fetchError?.message || "unknown"}`);
  }

  const nextBalance = roundMoney(Number(wallet.balance || 0) + delta);
  const { error: updateError } = await supabaseAdmin
    .from("wallets")
    .update({ balance: nextBalance, updated_at: new Date().toISOString() })
    .eq("id", walletId);

  if (updateError) {
    throw new Error(`Failed to update wallet ${walletId}: ${updateError.message}`);
  }

  return nextBalance;
};

const buildItems = (order: any) =>
  (Array.isArray(order?.items) ? order.items : []).map((item: any) => ({
    productId: item?.product_id,
    quantity: item?.quantity,
    unitPrice: item?.price,
  }));

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

    const buyerEmail = String(body?.buyerEmail || "").trim().toLowerCase();
    const sellerEmail = String(body?.sellerEmail || "").trim().toLowerCase();
    const orderNumber = String(body?.orderNumber || "").trim();

    if (!buyerEmail || !sellerEmail || !orderNumber) {
      return new Response(JSON.stringify({ error: "buyerEmail, sellerEmail and orderNumber are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: buyerProfile, error: buyerErr } = await supabaseAdmin
      .from("profiles")
      .select("id,email")
      .ilike("email", buyerEmail)
      .maybeSingle();

    if (buyerErr || !buyerProfile?.id) {
      throw new Error(`Buyer profile not found for ${buyerEmail}`);
    }

    const { data: sellerProfile, error: sellerErr } = await supabaseAdmin
      .from("profiles")
      .select("id,email")
      .ilike("email", sellerEmail)
      .maybeSingle();

    if (sellerErr || !sellerProfile?.id) {
      throw new Error(`Seller profile not found for ${sellerEmail}`);
    }

    const { data: receiptRows, error: receiptErr } = await supabaseAdmin
      .from("ticket_receipts")
      .select("id,order_id,order_number,buyer_id,owner_id,currency")
      .eq("order_number", orderNumber)
      .eq("buyer_id", buyerProfile.id);

    if (receiptErr || !(receiptRows || []).length) {
      throw new Error(`No ticket receipts found for order ${orderNumber} and buyer ${buyerEmail}`);
    }

    const orderId = String(receiptRows[0].order_id || "").trim();
    if (!orderId) {
      throw new Error(`Could not resolve order id from ticket receipts for ${orderNumber}`);
    }

    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .select("id,user_id,business_id,total_amount,video_id,payment_method,items,status")
      .eq("id", orderId)
      .single();

    if (orderErr || !order) {
      throw new Error(`Order not found for id ${orderId}`);
    }

    const provider = normalizeProvider(order.payment_method);
    const grossAmount = roundMoney(Number(order.total_amount || 0));
    if (!(grossAmount > 0)) {
      throw new Error(`Order ${orderId} has invalid gross amount`);
    }

    const netAmount = deriveNetAmount(grossAmount);
    const platformFeeAmount = roundMoney(Math.max(0, grossAmount - netAmount));
    const currencyFromReceipt = receiptRows.find((r: any) => !!r.currency)?.currency || null;
    const currency = String(currencyFromReceipt || "NGN").toUpperCase();
    const nowIso = new Date().toISOString();
    const items = buildItems(order);

    const sellerWallet = await ensureWallet(sellerProfile.id, currency, true);

    const { data: existingOwnerCreditRows, error: ownerCreditErr } = await supabaseAdmin
      .from("transactions")
      .select("id,wallet_id,amount,metadata")
      .eq("metadata->>entry", "owner_credit")
      .eq("metadata->>order_id", orderId)
      .eq("metadata->>payment_provider", provider)
      .order("created_at", { ascending: true });

    if (ownerCreditErr) {
      throw new Error(`Failed to load owner credit rows: ${ownerCreditErr.message}`);
    }

    let action = "noop";

    if ((existingOwnerCreditRows || []).length) {
      const ownerCredit = existingOwnerCreditRows[0];
      const oldWalletId = ownerCredit.wallet_id;
      const oldAmount = Number(ownerCredit.amount || 0);
      const metadata = ownerCredit?.metadata && typeof ownerCredit.metadata === "object" ? ownerCredit.metadata : {};

      if (oldWalletId !== sellerWallet.id) {
        await adjustWalletBalance(oldWalletId, -Math.abs(oldAmount));
        await adjustWalletBalance(sellerWallet.id, netAmount);
        action = "moved_owner_credit";
      } else if (Math.abs(oldAmount - netAmount) >= 0.01) {
        await adjustWalletBalance(sellerWallet.id, netAmount - oldAmount);
        action = "adjusted_owner_credit_amount";
      } else {
        action = "owner_credit_already_correct_wallet";
      }

      const { error: updateOwnerCreditErr } = await supabaseAdmin
        .from("transactions")
        .update({
          wallet_id: sellerWallet.id,
          amount: netAmount,
          metadata: {
            ...metadata,
            owner_id: sellerProfile.id,
            buyer_id: buyerProfile.id,
            order_id: orderId,
            payment_provider: provider,
            gross_amount: grossAmount,
            platform_fee_amount: platformFeeAmount,
            net_amount: netAmount,
            currency,
            items,
            repaired_at: nowIso,
          },
          updated_at: nowIso,
        })
        .eq("id", ownerCredit.id);

      if (updateOwnerCreditErr) {
        throw new Error(`Failed to update owner credit row: ${updateOwnerCreditErr.message}`);
      }
    } else {
      await adjustWalletBalance(sellerWallet.id, netAmount);
      const { error: insertOwnerCreditErr } = await supabaseAdmin
        .from("transactions")
        .insert({
          wallet_id: sellerWallet.id,
          amount: netAmount,
          type: "deposit",
          status: "completed",
          description: "Paystack sale settlement (targeted repair)",
          transaction_fee: 0,
          metadata: {
            entry: "owner_credit",
            owner_id: sellerProfile.id,
            buyer_id: buyerProfile.id,
            order_id: orderId,
            payment_provider: provider,
            gross_amount: grossAmount,
            platform_fee_amount: platformFeeAmount,
            net_amount: netAmount,
            currency,
            items,
            repaired_at: nowIso,
          },
          created_at: nowIso,
          updated_at: nowIso,
        });

      if (insertOwnerCreditErr) {
        throw new Error(`Failed to insert owner credit row: ${insertOwnerCreditErr.message}`);
      }
      action = "created_owner_credit";
    }

    const { data: buyerDebits, error: buyerDebitErr } = await supabaseAdmin
      .from("transactions")
      .select("id,metadata")
      .eq("metadata->>entry", "buyer_debit")
      .eq("metadata->>order_id", orderId)
      .eq("metadata->>payment_provider", provider);

    if (buyerDebitErr) {
      throw new Error(`Failed to load buyer debit rows: ${buyerDebitErr.message}`);
    }

    if ((buyerDebits || []).length) {
      await Promise.all(
        buyerDebits.map((tx: any) => {
          const metadata = tx?.metadata && typeof tx.metadata === "object" ? tx.metadata : {};
          return supabaseAdmin
            .from("transactions")
            .update({
              metadata: {
                ...metadata,
                owner_id: sellerProfile.id,
                buyer_id: buyerProfile.id,
                gross_amount: grossAmount,
                platform_fee_amount: platformFeeAmount,
                net_amount: netAmount,
                currency,
                repaired_at: nowIso,
              },
              updated_at: nowIso,
            })
            .eq("id", tx.id);
        })
      );
    }

    await supabaseAdmin
      .from("orders")
      .update({
        business_id: sellerProfile.id,
        status: "completed",
        updated_at: nowIso,
      })
      .eq("id", orderId);

    return new Response(
      JSON.stringify({
        success: true,
        action,
        orderId,
        orderNumber,
        buyerId: buyerProfile.id,
        sellerId: sellerProfile.id,
        grossAmount,
        netAmount,
        platformFeeAmount,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("repair-single-external-settlement error:", error);
    return new Response(
      JSON.stringify({ error: 'Request could not be completed' }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
