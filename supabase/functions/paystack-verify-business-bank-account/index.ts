// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const paystackSecretKey = Deno.env.get('PAYSTACK_SECRET_KEY') || '';
const supabaseUrl =
  Deno.env.get('SUPABASE_URL') ||
  `https://${Deno.env.get('SUPABASE_PROJECT_REF') || 'rvvujgbaswecqohixgog'}.supabase.co`;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const supabaseAdmin =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

const paystackHeaders = {
  Authorization: `Bearer ${paystackSecretKey}`,
  'Content-Type': 'application/json',
};

const normalize = (value: string) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

let bankCatalogCache: Array<{ name: string; code: string }> | null = null;

const fetchBankCatalog = async () => {
  if (bankCatalogCache) return bankCatalogCache;

  const response = await fetch('https://api.paystack.co/bank?country=nigeria', {
    headers: paystackHeaders,
  });

  const body = await response.json();
  if (!response.ok || !body?.status) {
    throw new Error(body?.message || 'Failed to fetch Paystack bank list');
  }

  bankCatalogCache = Array.isArray(body.data)
    ? body.data.map((entry: any) => ({
        name: String(entry.name || '').trim(),
        code: String(entry.code || '').trim(),
      }))
    : [];

  return bankCatalogCache;
};

const resolveBankCode = async (bankName: string, providedBankCode?: string) => {
  const explicit = String(providedBankCode || '').trim();
  if (explicit) return explicit;

  const name = normalize(bankName);
  if (!name) return '';

  const catalog = await fetchBankCatalog();
  const matched = catalog.find((entry) => normalize(entry.name) === name) || catalog.find((entry) => normalize(entry.name).includes(name));
  return matched?.code || '';
};

const createRecipient = async (payload: { name: string; accountNumber: string; bankCode: string; currency: string }) => {
  const response = await fetch('https://api.paystack.co/transferrecipient', {
    method: 'POST',
    headers: paystackHeaders,
    body: JSON.stringify({
      type: 'nuban',
      name: payload.name,
      account_number: payload.accountNumber,
      bank_code: payload.bankCode,
      currency: payload.currency || 'NGN',
    }),
  });

  const body = await response.json();
  if (!response.ok || !body?.status) {
    throw new Error(body?.message || 'Failed to create Paystack transfer recipient');
  }

  return body.data;
};

const resolveAccount = async (bankCode: string, accountNumber: string) => {
  const response = await fetch(
    `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    { headers: paystackHeaders }
  );

  const body = await response.json();
  if (!response.ok || !body?.status) {
    throw new Error(body?.message || 'Failed to resolve bank account');
  }

  return body.data;
};

const namesMatch = (left: string, right: string) => normalize(left) === normalize(right);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!paystackSecretKey) {
      return new Response(
        JSON.stringify({
          verified: false,
          verificationStatus: 'failed',
          verificationReason: 'Paystack is not configured on the server (missing PAYSTACK_SECRET_KEY).',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return new Response(
        JSON.stringify({
          verified: false,
          verificationStatus: 'failed',
          verificationReason: 'Missing bearer token for Paystack verification request.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!supabaseAdmin) {
      return new Response(
        JSON.stringify({
          verified: false,
          verificationStatus: 'failed',
          verificationReason: 'Supabase service role is not configured for Paystack verification.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(
        JSON.stringify({
          verified: false,
          verificationStatus: 'failed',
          verificationReason: 'Unauthorized Paystack verification request.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const payload = await req.json();
    const countryCode = String(payload?.countryCode || '').trim().toUpperCase();
    if (countryCode && countryCode !== 'NG') {
      return new Response(
        JSON.stringify({
          verified: false,
          verificationStatus: 'failed',
          verificationReason: 'Paystack bank verification is only available for Nigerian bank accounts.',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const accountName = String(payload?.accountName || '').trim();
    const accountNumber = String(payload?.accountNumber || '').trim();
    const bankName = String(payload?.bankName || '').trim();
    const currency = String(payload?.currency || 'NGN').trim().toUpperCase() || 'NGN';
    const refreshOnly = payload?.refreshOnly === true;
    const resolveOnly = payload?.resolveOnly === true;
    const existingRecipientCode = String(payload?.paystackRecipientCode || '').trim();

    if (!accountName || !accountNumber || !bankName) {
      return new Response(JSON.stringify({ error: 'accountName, accountNumber, and bankName are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const bankCode = await resolveBankCode(bankName, payload?.bankCode);
    if (!bankCode) {
      return new Response(
        JSON.stringify({
          verified: false,
          verificationStatus: 'failed',
          verificationReason: `Unable to resolve a Paystack bank code for ${bankName}.`,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const resolvedAccount = await resolveAccount(bankCode, accountNumber);
    const resolvedAccountName = String(resolvedAccount?.account_name || '').trim();

    const isResolvedNameMatch = namesMatch(accountName, resolvedAccountName);
    const effectiveAccountName = resolvedAccountName || accountName;
    const verificationWarning = !isResolvedNameMatch && resolvedAccountName
      ? `Paystack resolved ${resolvedAccountName} for this bank account. Saved using the resolved account name.`
      : null;

    if (resolveOnly) {
      return new Response(
        JSON.stringify({
          verified: true,
          verificationStatus: 'verified',
          verificationReason: verificationWarning,
          accountName: effectiveAccountName,
          bankCode,
          resolved: true,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const recipient =
      refreshOnly && existingRecipientCode
        ? { recipient_code: existingRecipientCode, id: payload?.paystackRecipientId || null }
        : await createRecipient({ name: effectiveAccountName, accountNumber, bankCode, currency });

    return new Response(
      JSON.stringify({
        verified: true,
        verificationStatus: 'verified',
        verificationReason: verificationWarning,
        accountName: effectiveAccountName,
        bankCode,
        paystackRecipientCode: recipient?.recipient_code || existingRecipientCode || null,
        paystackRecipientId: recipient?.id || payload?.paystackRecipientId || null,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('paystack-verify-business-bank-account error:', error);
    return new Response(
      JSON.stringify({
        verified: false,
        verificationStatus: 'failed',
        verificationReason: error?.message || 'Paystack verification failed.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});