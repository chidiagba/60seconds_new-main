import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
// @ts-nocheck
import { corsForRequest } from '../_shared/cors.ts';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';



const PAYSTACK_SECRET_KEY = Deno.env.get('PAYSTACK_SECRET_KEY') || '';
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

/**
 * Convert an amount from any currency to NGN.
 * Uses open.er-api.com (no API key required for basic rates).
 * Falls back to hardcoded approximate rates if the request fails.
 */
const FALLBACK_RATES_TO_NGN: Record<string, number> = {
  NGN: 1,
  USD: 1600,
  EUR: 1730,
  GBP: 2020,
  GHS: 108,
  ZAR: 87,
  KES: 12,
  XOF: 2.6,
  CAD: 1180,
  AUD: 1040,
  JPY: 10.5,
  CNY: 220,
  INR: 19,
  BRL: 310,
};

async function toNGN(amount: number, fromCurrency: string): Promise<{ amountNGN: number; rate: number; source: string }> {
  const upper = String(fromCurrency || 'USD').toUpperCase().trim();
  if (upper === 'NGN') return { amountNGN: amount, rate: 1, source: 'identity' };

  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${upper}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      const ngnRate: number = data?.rates?.NGN;
      if (ngnRate && ngnRate > 0) {
        return { amountNGN: amount * ngnRate, rate: ngnRate, source: 'live' };
      }
    }
  } catch (_) {
    // fall through to hardcoded
  }

  const fallbackRate = FALLBACK_RATES_TO_NGN[upper] ?? FALLBACK_RATES_TO_NGN['USD'];
  return { amountNGN: amount * fallbackRate, rate: fallbackRate, source: 'fallback' };
}

Deno.serve(async (req) => {
  const corsHeaders = corsForRequest(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Always respond with HTTP 200 so supabase.functions.invoke() never throws
  // a generic "non-2xx" error. Errors are encoded as { success: false, error: '...' }.
  const respond = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    if (!PAYSTACK_SECRET_KEY) {
      return respond({ success: false, error: 'Paystack secret key is not configured on the server.' });
    }

    const payload = await req.json().catch(() => ({}));
    const authClient=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!);
    const {data:auth,error:authError}=await authClient.auth.getUser((req.headers.get('authorization')||'').replace(/^Bearer\s+/i,''));
    if(authError||!auth.user)return new Response(JSON.stringify({success:false,error:'Authentication required'}),{status:401,headers:{...corsHeaders,'Content-Type':'application/json'}});
    const requestedType=String(payload.paymentType||payload.metadata?.paymentType||'order_payment');
    if(requestedType!=='wallet_funding')return new Response(JSON.stringify({success:false,error:'Use server-priced order checkout',code:'CHECKOUT_UPGRADE_REQUIRED'}),{status:426,headers:{...corsHeaders,'Content-Type':'application/json'}});
    if(String(payload.currency||'NGN').toUpperCase()!=='NGN')return respond({success:false,error:'Paystack wallet funding requires NGN'});
    payload.userId=auth.user.id;payload.email=auth.user.email;
    payload.metadata={...payload.metadata,userId:auth.user.id,paymentType:'wallet_funding'};
    delete payload.subaccount;delete payload.split_code;delete payload.transaction_charge;


    const {
      email,
      amount,
      currency = 'NGN',
      reference,
      callback_url,
      metadata = {},
      channels,
      subaccount,
      split_code,
      transaction_charge,
      bearer,
      userId,
      orderId,
      walletId,
      paymentType = 'order_payment',
    } = payload;

    const normalizedSubaccount = String(subaccount || '').trim();
    const normalizedSplitCode = String(split_code || '').trim();
    // Paystack requires subaccount for one beneficiary and split_code for split groups.
    // If both are sent, prefer subaccount to avoid API routing ambiguity.
    const effectiveSubaccount = normalizedSubaccount || undefined;
    const effectiveSplitCode = effectiveSubaccount ? undefined : (normalizedSplitCode || undefined);

    if (!email) return respond({ success: false, error: 'email is required' });
    if (!amount || amount <= 0) return respond({ success: false, error: 'amount must be a positive number' });

    // Always charge in NGN; convert if the product is priced in another currency.
    const { amountNGN, rate, source: rateSource } = await toNGN(amount, currency);

    // Paystack expects amount in kobo (1 NGN = 100 kobo). Minimum is ₦100 (10,000 kobo).
    const rawKobo = Math.round(amountNGN * 100);
    const amountKobo = Math.max(rawKobo, 10000); // enforce ₦100 minimum

    const parsedTransactionCharge = Number(transaction_charge);
    let transactionChargeKobo: number | undefined = undefined;
    if (Number.isFinite(parsedTransactionCharge) && parsedTransactionCharge > 0) {
      // Accept both major-unit values (e.g. 120.50) and minor-unit values (e.g. 12050).
      const inferredKobo = parsedTransactionCharge <= amountNGN
        ? Math.round(parsedTransactionCharge * 100)
        : Math.round(parsedTransactionCharge);
      transactionChargeKobo = Math.min(Math.max(inferredKobo, 0), amountKobo);
    }

    // Default to a 4% platform fee split when routing to a single subaccount and
    // no explicit transaction charge was supplied by the caller.
    if (transactionChargeKobo === undefined && effectiveSubaccount) {
      transactionChargeKobo = Math.min(Math.round(amountKobo * 0.04), amountKobo);
    }

    const ref = reference || `60s_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const paystackPayload: Record<string, unknown> = {
      email,
      amount: amountKobo,
      currency: 'NGN',
      reference: ref,
      callback_url: callback_url ?? undefined,
      metadata: {
        ...metadata,
        app_name: '60Seconds',
        original_amount: amount,
        original_currency: currency,
        ngn_rate: rate,
        ngn_rate_source: rateSource,
        userId,
        orderId,
        walletId,
        paymentType,
        split_mode: effectiveSubaccount ? 'single_subaccount' : (effectiveSplitCode ? 'split_group' : 'none'),
        timestamp: new Date().toISOString(),
      },
      channels: channels ?? ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer'],
      subaccount: effectiveSubaccount,
      split_code: effectiveSplitCode,
      transaction_charge: transactionChargeKobo,
      bearer:
        bearer === 'account' || bearer === 'subaccount'
          ? bearer
          : (effectiveSubaccount || effectiveSplitCode)
            ? 'account'
            : undefined,
    };

    const paystackRes = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(paystackPayload),
    });

    const paystackData = await paystackRes.json();

    if (!paystackRes.ok || paystackData?.status!==true) {
      return respond({
        success: false,
        error: 'Request could not be completed',
        paystack_status: paystackRes.status,
      });
    }

    return respond({
      success: true,
      data: {
        authorization_url: paystackData.data.authorization_url,
        access_code: paystackData.data.access_code,
        reference: paystackData.data.reference,
        amount_kobo: amountKobo,
        amount_ngn: amountKobo / 100,
        rate,
        rate_source: rateSource,
        original_amount: amount,
        original_currency: currency,
      },
    });
  } catch (err: any) {
    console.error('paystack-initialize error:', err);
    return respond({ success: false, error: 'Request could not be completed' });
  }
});
