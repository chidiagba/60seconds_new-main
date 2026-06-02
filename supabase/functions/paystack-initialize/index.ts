// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

    const {
      email,
      amount,
      currency = 'NGN',
      reference,
      callback_url,
      metadata = {},
      channels,
      userId,
      orderId,
      walletId,
      paymentType = 'order_payment',
    } = payload;

    if (!email) return respond({ success: false, error: 'email is required' });
    if (!amount || amount <= 0) return respond({ success: false, error: 'amount must be a positive number' });

    // Always charge in NGN; convert if the product is priced in another currency.
    const { amountNGN, rate, source: rateSource } = await toNGN(amount, currency);

    // Paystack expects amount in kobo (1 NGN = 100 kobo). Minimum is ₦100 (10,000 kobo).
    const rawKobo = Math.round(amountNGN * 100);
    const amountKobo = Math.max(rawKobo, 10000); // enforce ₦100 minimum

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
        timestamp: new Date().toISOString(),
      },
      channels: channels ?? ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer'],
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

    if (!paystackRes.ok || !paystackData?.status) {
      return respond({
        success: false,
        error: paystackData?.message || 'Paystack transaction initialization failed.',
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
    return respond({ success: false, error: err?.message || 'Internal error initializing Paystack payment.' });
  }
});
