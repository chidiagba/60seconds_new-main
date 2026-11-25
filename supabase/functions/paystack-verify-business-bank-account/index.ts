import {paymentHttpStatus} from '../_shared/payment-http.ts';
// @ts-nocheck
import { corsForRequest } from '../_shared/cors.ts';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';



const paystackSecretKey = Deno.env.get('PAYSTACK_SECRET_KEY') || '';
const supabaseUrl =
  Deno.env.get('SUPABASE_URL') || '';
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

const paystackMode = paystackSecretKey.startsWith('sk_live_') ? 'live' : 'test';

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

const createSubaccount = async (payload: {
  businessName: string;
  accountNumber: string;
  bankCode: string;
  percentageCharge?: number;
}) => {
  const response = await fetch('https://api.paystack.co/subaccount', {
    method: 'POST',
    headers: paystackHeaders,
    body: JSON.stringify({
      business_name: payload.businessName,
      settlement_bank: payload.bankCode,
      account_number: payload.accountNumber,
      percentage_charge: Number.isFinite(Number(payload.percentageCharge)) ? Number(payload.percentageCharge) : 4,
    }),
  });

  const body = await response.json();
  if (!response.ok || !body?.status) {
    throw new Error(body?.message || 'Failed to create Paystack subaccount');
  }

  return body.data;
};

const listSubaccountsPage = async (page: number, perPage = 100) => {
  const response = await fetch(`https://api.paystack.co/subaccount?perPage=${perPage}&page=${page}`, {
    headers: paystackHeaders,
  });

  const body = await response.json();
  if (!response.ok || !body?.status) {
    throw new Error(body?.message || 'Failed to fetch Paystack subaccounts');
  }

  return Array.isArray(body.data) ? body.data : [];
};

const findMatchingSubaccount = async (payload: { accountNumber: string; bankCode: string }) => {
  const targetAccountNumber = String(payload.accountNumber || '').trim();
  const targetBankCode = String(payload.bankCode || '').trim();
  if (!targetAccountNumber) return null;

  const perPage = 100;
  const maxPages = 20;

  for (let page = 1; page <= maxPages; page += 1) {
    const pageRows = await listSubaccountsPage(page, perPage);
    if (!pageRows.length) break;

    const exactMatch = pageRows.find((entry: any) => {
      const entryAccountNumber = String(entry?.account_number || '').trim();
      const entryBankCode = String(entry?.settlement_bank_code || '').trim();
      return entryAccountNumber === targetAccountNumber && (!entryBankCode || entryBankCode === targetBankCode);
    });

    if (exactMatch) return exactMatch;

    if (pageRows.length < perPage) break;
  }

  return null;
};

const getSubaccountByCode = async (subaccountCode: string) => {
  const code = String(subaccountCode || '').trim();
  if (!code) return null;

  const response = await fetch(`https://api.paystack.co/subaccount/${encodeURIComponent(code)}`, {
    headers: paystackHeaders,
  });

  const body = await response.json();
  if (!response.ok || !body?.status) {
    throw new Error(body?.message || 'Failed to fetch Paystack subaccount details');
  }

  return body?.data || null;
};

const resolveBusinessName = (user: any, accountName: string) => {
  const metadata = (user?.user_metadata || {}) as Record<string, any>;
  const fromMetadata =
    metadata.business_name ||
    metadata.businessName ||
    metadata.company_name ||
    metadata.companyName ||
    metadata.full_name ||
    metadata.fullName;
  const fromProfile =
    user?.user_metadata?.name ||
    [user?.user_metadata?.first_name, user?.user_metadata?.last_name].filter(Boolean).join(' ');
  const fromEmail = String(user?.email || '').split('@')[0] || '';

  return String(fromMetadata || fromProfile || accountName || fromEmail || 'Business').trim();
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
  const corsHeaders = corsForRequest(req);
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
        { status: paymentHttpStatus({
          verified: false,
          verificationStatus: 'failed',
          verificationReason: 'Paystack is not configured on the server (missing PAYSTACK_SECRET_KEY).',
        }), headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
          status: paymentHttpStatus({
          verified: false,
          verificationStatus: 'failed',
          verificationReason: 'Missing bearer token for Paystack verification request.',
        }),
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
          status: paymentHttpStatus({
          verified: false,
          verificationStatus: 'failed',
          verificationReason: 'Supabase service role is not configured for Paystack verification.',
        }),
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
          status: paymentHttpStatus({
          verified: false,
          verificationStatus: 'failed',
          verificationReason: 'Unauthorized Paystack verification request.',
        }),
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
        { status: paymentHttpStatus({
          verified: false,
          verificationStatus: 'failed',
          verificationReason: 'Paystack bank verification is only available for Nigerian bank accounts.',
        }), headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const accountName = String(payload?.accountName || '').trim();
    const accountNumber = String(payload?.accountNumber || '').trim();
    const bankName = String(payload?.bankName || '').trim();
    const currency = 'NGN';
    const refreshOnly = payload?.refreshOnly === true;
    const resolveOnly = payload?.resolveOnly === true;
    const existingRecipientCode = ''; // Never trust provider identifiers from clients.
    const existingSubaccountCode = '';

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
        { status: paymentHttpStatus({
          verified: false,
          verificationStatus: 'failed',
          verificationReason: `Unable to resolve a Paystack bank code for ${bankName}.`,
        }), headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

    let subaccount: any = null;
    if (existingSubaccountCode) {
      subaccount = {
        subaccount_code: existingSubaccountCode,
        id: payload?.paystackSubaccountId || null,
      };
    } else {
      const matchedSubaccount = await findMatchingSubaccount({
        accountNumber,
        bankCode,
      });

      subaccount =
        matchedSubaccount ||
        (await createSubaccount({
          businessName: resolveBusinessName(userData.user, effectiveAccountName),
          accountNumber,
          bankCode,
          percentageCharge: 4,
        }));
    }

    const subaccountCode = String(subaccount?.subaccount_code || existingSubaccountCode || '').trim();
    const hydratedSubaccount = subaccountCode ? await getSubaccountByCode(subaccountCode) : null;
    const paystackSubaccountVerified = hydratedSubaccount?.is_verified === true;
    const recipientCode = String(recipient?.recipient_code || existingRecipientCode || '').trim();
    const splitRoutingReady = Boolean(recipientCode && subaccountCode);
    const verificationStatus = splitRoutingReady ? 'verified' : 'failed';
    const subaccountReason = !paystackSubaccountVerified
      ? 'Paystack subaccount KYC is still pending on the dashboard, but payout routing has been created.'
      : null;
    const combinedReason = [verificationWarning, subaccountReason].filter(Boolean).join(' ');

    if (!splitRoutingReady) throw new Error('Bank verification incomplete');
    const { error: saveError } = await supabaseAdmin.from('business_bank_accounts').upsert({
      user_id:userData.user.id,bank_name:bankName,account_holder_name:effectiveAccountName,account_number:accountNumber,
      bank_code:bankCode,country:'Nigeria',country_code:'NG',currency:'NGN',payout_provider:'paystack',
      is_verified:true,verification_status:'verified',verification_source:'server_v2',verified_at:new Date().toISOString(),
      is_active:true,is_primary:true,paystack_recipient_code:recipientCode,paystack_recipient_id:String(recipient.id),
      paystack_subaccount_code:subaccountCode,paystack_subaccount_id:String(hydratedSubaccount?.id || subaccount.id),
      stripe_connected_account_id:null,stripe_external_account_id:null,
    },{onConflict:'user_id'});
    if(saveError) throw new Error('Could not save verified bank account');
    return new Response(
      JSON.stringify({
        verified: splitRoutingReady,
        verificationStatus,
        verificationReason: combinedReason || null,
        paystackMode,
        accountName: effectiveAccountName,
        bankCode,
        paystackSplitRoutingReady: splitRoutingReady,
        paystackRecipientCode: recipientCode || null,
        paystackRecipientId: recipient?.id || payload?.paystackRecipientId || null,
        paystackSubaccountCode: subaccountCode || null,
        paystackSubaccountId: hydratedSubaccount?.id || subaccount?.id || payload?.paystackSubaccountId || null,
        paystackSubaccountName: hydratedSubaccount?.business_name || subaccount?.business_name || null,
        paystackSubaccountVerified,
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
      { status: paymentHttpStatus({
        verified: false,
        verificationStatus: 'failed',
        verificationReason: error?.message || 'Paystack verification failed.',
      }), headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});