// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PAYSTACK_SECRET_KEY = Deno.env.get('PAYSTACK_SECRET_KEY') || '';
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Always return HTTP 200 so supabase.functions.invoke() never throws generically.
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
    const reference: string = payload?.reference;

    if (!reference) return respond({ success: false, error: 'reference is required' });

    const paystackRes = await fetch(`${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await paystackRes.json();

    if (!paystackRes.ok || !data?.status) {
      return respond({ success: false, error: data?.message || 'Paystack verification failed.' });
    }

    const tx = data.data ?? {};

    return respond({
      success: true,
      data: {
        id: tx.id,
        reference: tx.reference,
        amount: tx.amount,
        currency: tx.currency,
        status: tx.status,
        gateway_response: tx.gateway_response,
        paid_at: tx.paid_at,
        created_at: tx.created_at,
        channel: tx.channel,
        customer: {
          id: tx.customer?.id,
          email: tx.customer?.email,
          customer_code: tx.customer?.customer_code,
        },
        authorization: tx.authorization
          ? {
              authorization_code: tx.authorization?.authorization_code,
              bin: tx.authorization?.bin,
              last4: tx.authorization?.last4,
              exp_month: tx.authorization?.exp_month,
              exp_year: tx.authorization?.exp_year,
              channel: tx.authorization?.channel,
              card_type: tx.authorization?.card_type,
              bank: tx.authorization?.bank,
              country_code: tx.authorization?.country_code,
              brand: tx.authorization?.brand,
              reusable: tx.authorization?.reusable,
            }
          : null,
        metadata: tx.metadata,
      },
    });
  } catch (err: any) {
    console.error('paystack-verify error:', err);
    return respond({ success: false, error: err?.message || 'Internal error verifying Paystack payment.' });
  }
});
