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

if (!paystackSecretKey) throw new Error('Missing PAYSTACK_SECRET_KEY');
if (!supabaseUrl || !supabaseServiceKey) throw new Error('Missing Supabase env for paystack-withdraw-business-bank-account');

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

const ensureRecipientCode = async (bankAccount: any) => {
  const existingCode = String(bankAccount?.paystack_recipient_code || '').trim();
  if (existingCode) return existingCode;

  const bankCode = String(bankAccount?.bank_code || '').trim();
  if (!bankCode) {
    throw new Error('Paystack bank code is missing for this bank account');
  }

  const recipient = await createRecipient({
    name: String(bankAccount?.account_holder_name || '').trim(),
    accountNumber: String(bankAccount?.account_number || '').trim(),
    bankCode,
    currency: String(bankAccount?.currency || 'NGN').trim().toUpperCase() || 'NGN',
  });

  await supabaseAdmin
    .from('business_bank_accounts')
    .update({
      paystack_recipient_code: recipient?.recipient_code || null,
      paystack_recipient_id: recipient?.id || null,
    })
    .eq('id', bankAccount.id);

  return recipient?.recipient_code || '';
};

const createTransfer = async (payload: { recipient: string; amount: number; reason: string; reference: string }) => {
  const response = await fetch('https://api.paystack.co/transfer', {
    method: 'POST',
    headers: paystackHeaders,
    body: JSON.stringify({
      source: 'balance',
      amount: payload.amount,
      recipient: payload.recipient,
      reason: payload.reason,
      reference: payload.reference,
    }),
  });

  const body = await response.json();
  if (!response.ok || !body?.status) {
    throw new Error(body?.message || 'Failed to create Paystack transfer');
  }

  return body.data;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing bearer token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = await req.json();
    const amount = Number(payload?.amount || 0);
    const businessBankAccountId = String(payload?.businessBankAccountId || '').trim();
    const withdrawalRequestId = String(payload?.withdrawalRequestId || '').trim();
    const countryCode = String(payload?.countryCode || '').trim().toUpperCase();

    if (!Number.isFinite(amount) || amount <= 0) {
      return new Response(JSON.stringify({ error: 'amount must be a positive number' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let bankQuery = supabaseAdmin
      .from('business_bank_accounts')
      .select('*')
      .eq('user_id', userData.user.id)
      .eq('is_active', true);

    if (businessBankAccountId) {
      bankQuery = bankQuery.eq('id', businessBankAccountId);
    }

    const { data: bankAccount, error: bankError } = await bankQuery.maybeSingle();

    if (bankError) {
      throw new Error(`Failed to load business bank account: ${bankError.message}`);
    }

    if (!bankAccount) {
      throw new Error('No active business bank account found for this withdrawal');
    }

    if (String(bankAccount.payout_provider || '').toLowerCase() !== 'paystack' || countryCode !== 'NG') {
      throw new Error('This withdrawal route is only for Nigerian Paystack payout accounts');
    }

    if (bankAccount.is_verified !== true) {
      throw new Error('Paystack bank account is not verified yet');
    }

    const recipient = await ensureRecipientCode(bankAccount);
    if (!recipient) {
      throw new Error('Unable to resolve a Paystack transfer recipient');
    }

    const reference = String(payload?.reference || `withdraw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    const transfer = await createTransfer({
      recipient,
      amount: Math.round(amount * 100),
      reason: `Wallet withdrawal for ${userData.user.id}`,
      reference,
    });

    if (withdrawalRequestId) {
      const transferStatus = String(transfer?.status || '').toLowerCase();
      const withdrawalStatus = transferStatus === 'success' ? 'completed' : transferStatus || 'processing';

      await supabaseAdmin
        .from('withdrawal_requests')
        .update({ status: withdrawalStatus })
        .eq('id', withdrawalRequestId)
        .eq('user_id', userData.user.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        status: transfer?.status || 'processing',
        transfer,
        recipient,
        reference,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('paystack-withdraw-business-bank-account error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        status: 'failed',
        error: error?.message || 'Paystack withdrawal failed.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});