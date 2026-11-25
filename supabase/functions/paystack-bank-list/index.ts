import {paymentHttpStatus} from '../_shared/payment-http.ts';
// @ts-nocheck
import { corsForRequest } from '../_shared/cors.ts';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';



const paystackSecretKey = Deno.env.get('PAYSTACK_SECRET_KEY') || '';

const normalizeCountryCode = (value: string) => String(value || '').trim().toUpperCase();

const paystackHeaders = {
  Authorization: `Bearer ${paystackSecretKey}`,
  'Content-Type': 'application/json',
};

let cachedNigeriaBanks: Array<{ name: string; code: string }> | null = null;

const fetchNigeriaBanks = async () => {
  if (cachedNigeriaBanks) return cachedNigeriaBanks;

  const response = await fetch('https://api.paystack.co/bank?country=nigeria', {
    headers: paystackHeaders,
  });

  const body = await response.json();
  if (!response.ok || !body?.status) {
    throw new Error(body?.message || 'Failed to load Paystack bank list');
  }

  cachedNigeriaBanks = Array.isArray(body.data)
    ? body.data.map((entry: any) => ({
        name: String(entry?.name || '').trim(),
        code: String(entry?.code || '').trim(),
      }))
    : [];

  return cachedNigeriaBanks;
};

Deno.serve(async (req) => {
  const corsHeaders = corsForRequest(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!paystackSecretKey) {
      return new Response(
        JSON.stringify({
          banks: [],
          countryCode: 'NG',
          source: 'fallback',
          error: 'Paystack is not configured on the server (missing PAYSTACK_SECRET_KEY).',
        }),
        { status: paymentHttpStatus({
          banks: [],
          countryCode: 'NG',
          source: 'fallback',
          error: 'Paystack is not configured on the server (missing PAYSTACK_SECRET_KEY).',
        }), headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const payload = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const countryCode = normalizeCountryCode(payload?.countryCode || payload?.country_code || 'NG');

    if (countryCode !== 'NG') {
      return new Response(
        JSON.stringify({
          banks: [],
          countryCode,
          source: 'paystack',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const banks = await fetchNigeriaBanks();

    return new Response(
      JSON.stringify({
        banks,
        countryCode: 'NG',
        source: 'paystack',
        refreshedAt: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('paystack-bank-list error:', error);
    return new Response(
      JSON.stringify({
        banks: [],
        countryCode: 'NG',
        source: 'fallback',
        error: 'Request could not be completed',
      }),
      { status: paymentHttpStatus({
        banks: [],
        countryCode: 'NG',
        source: 'fallback',
        error: 'Request could not be completed',
      }), headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});