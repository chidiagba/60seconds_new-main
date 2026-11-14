// @ts-nocheck
import { corsForRequest } from '../_shared/cors.ts';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';



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

const isUuidLike = (value?: string | null) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());

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

  if (isUuidLike(bankAccount?.id)) {
    await supabaseAdmin
      .from('business_bank_accounts')
      .update({
        paystack_recipient_code: recipient?.recipient_code || null,
        paystack_recipient_id: recipient?.id || null,
      })
      .eq('id', bankAccount.id);
  }

  return recipient?.recipient_code || '';
};

const buildFallbackBankAccount = (payload: any, userId: string) => {
  const bankName = String(payload?.bankName || '').trim();
  const accountName = String(payload?.accountName || '').trim();
  const accountNumber = String(payload?.accountNumber || '').trim();
  const bankCode = String(payload?.bankCode || '').trim();
  const payoutProvider = String(payload?.payoutProvider || 'paystack').trim().toLowerCase() || 'paystack';
  const paystackRecipientCode = String(payload?.paystackRecipientCode || '').trim();
  const currency = String(payload?.currency || 'NGN').trim().toUpperCase() || 'NGN';

  if (!bankName || !accountName || !accountNumber) {
    return null;
  }

  return {
    id: isUuidLike(payload?.businessBankAccountId) ? String(payload.businessBankAccountId) : `meta_${userId}`,
    user_id: userId,
    bank_name: bankName,
    account_holder_name: accountName,
    account_number: accountNumber,
    bank_code: bankCode,
    payout_provider: payoutProvider,
    currency,
    is_verified: true,
    paystack_recipient_code: paystackRecipientCode,
    paystack_recipient_id: String(payload?.paystackRecipientId || '').trim() || null,
  };
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

const isCompletedTransferStatus = (status: string) => String(status || '').trim().toLowerCase() === 'success';

const mapTransferStatusToTxStatus = (status: string): 'completed' | 'pending' =>
  isCompletedTransferStatus(status) ? 'completed' : 'pending';

const reserveWalletFundsForWithdrawal = async (params: {
  userId: string;
  amount: number;
  transferStatus: string;
  transfer: any;
  reference: string;
  withdrawalRequestId?: string;
}) => {
  const { userId, amount, transferStatus, transfer, reference, withdrawalRequestId } = params;

  const { data: wallet, error: walletError } = await supabaseAdmin
    .from('wallets')
    .select('id,balance')
    .eq('user_id', userId)
    .maybeSingle();

  if (walletError) {
    throw new Error(`Failed to load wallet for withdrawal: ${walletError.message}`);
  }

  if (!wallet?.id) {
    throw new Error('No wallet found for this user');
  }

  if (withdrawalRequestId) {
    const { data: existingTx } = await supabaseAdmin
      .from('transactions')
      .select('id')
      .eq('wallet_id', wallet.id)
      .eq('metadata->>entry', 'owner_withdrawal')
      .eq('metadata->>withdrawal_request_id', withdrawalRequestId)
      .maybeSingle();

    if (existingTx?.id) {
      return { wallet, alreadyRecorded: true, balanceAfter: Number(wallet.balance || 0), txId: existingTx.id };
    }
  }

  const currentBalance = Number(wallet.balance || 0);
  if (currentBalance < amount) {
    throw new Error('Insufficient withdrawable wallet balance');
  }

  const nowIso = new Date().toISOString();
  const txStatus = mapTransferStatusToTxStatus(transferStatus);
  const nextBalance = txStatus === 'completed'
    ? Number((currentBalance - amount).toFixed(2))
    : currentBalance;

  const { data: insertedTx, error: txError } = await supabaseAdmin
    .from('transactions')
    .insert({
      wallet_id: wallet.id,
      amount,
      type: 'withdrawal',
      status: txStatus,
      description: 'Wallet withdrawal to linked bank account',
      transaction_fee: 0,
      metadata: {
        entry: 'owner_withdrawal',
        payout_provider: 'paystack',
        withdrawal_request_id: withdrawalRequestId || null,
        paystack_transfer_id: transfer?.id ? String(transfer.id) : null,
        paystack_transfer_code: transfer?.transfer_code ? String(transfer.transfer_code) : null,
        paystack_status: transferStatus,
        reference,
      },
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select('id')
    .single();

  if (txError || !insertedTx?.id) {
    throw new Error(`Failed to record withdrawal transaction: ${txError?.message || 'unknown error'}`);
  }

  const { error: walletUpdateError } = await supabaseAdmin
    .from('wallets')
    .update({ balance: nextBalance, updated_at: nowIso })
    .eq('id', wallet.id);

  if (walletUpdateError) {
    throw new Error(`Failed to update wallet balance after withdrawal: ${walletUpdateError.message}`);
  }

  return { wallet, alreadyRecorded: false, balanceAfter: nextBalance, txId: insertedTx.id };
};

Deno.serve(async (req) => {
  const corsHeaders = corsForRequest(req);
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

    const fallbackBankAccount = !bankAccount ? buildFallbackBankAccount(payload, userData.user.id) : null;
    const effectiveBankAccount = bankAccount || fallbackBankAccount;

    if (!effectiveBankAccount) {
      throw new Error('No active business bank account found for this withdrawal');
    }

    if (String(effectiveBankAccount.payout_provider || '').toLowerCase() !== 'paystack' || countryCode !== 'NG') {
      throw new Error('This withdrawal route is only for Nigerian Paystack payout accounts');
    }

    if (effectiveBankAccount.is_verified !== true) {
      throw new Error('Paystack bank account is not verified yet');
    }

    const recipient = await ensureRecipientCode(effectiveBankAccount);
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

    const transferStatus = String(transfer?.status || '').toLowerCase() || 'processing';
    const walletReservation = await reserveWalletFundsForWithdrawal({
      userId: userData.user.id,
      amount,
      transferStatus,
      transfer,
      reference,
      withdrawalRequestId: withdrawalRequestId || undefined,
    });

    if (withdrawalRequestId) {
      const withdrawalStatus = isCompletedTransferStatus(transferStatus) ? 'completed' : 'processing';

      await supabaseAdmin
        .from('withdrawal_requests')
        .update({
          status: withdrawalStatus,
          processed_at: isCompletedTransferStatus(transferStatus) ? new Date().toISOString() : null,
        })
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
        withdrawalTransactionId: walletReservation.txId,
        walletBalanceAfter: walletReservation.balanceAfter,
        alreadyRecorded: walletReservation.alreadyRecorded,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('paystack-withdraw-business-bank-account error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        status: 'failed',
        error: 'Request could not be completed',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
