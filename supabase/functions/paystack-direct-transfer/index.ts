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
if (!supabaseUrl || !supabaseServiceKey) throw new Error('Missing Supabase env for paystack-direct-transfer');

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const paystackHeaders = {
  Authorization: `Bearer ${paystackSecretKey}`,
  'Content-Type': 'application/json',
};

const respond = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

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
  const isNigerianPaystackAccount =
    String(bankAccount?.payout_provider || '').trim().toLowerCase() === 'paystack' &&
    String(bankAccount?.country_code || '').trim().toUpperCase() === 'NG';
  const targetCurrency = isNigerianPaystackAccount
    ? 'NGN'
    : (String(bankAccount?.currency || 'NGN').trim().toUpperCase() || 'NGN');

  const existingCode = String(bankAccount?.paystack_recipient_code || '').trim();
  const shouldRotateRecipientCode =
    isNigerianPaystackAccount && String(bankAccount?.currency || '').trim().toUpperCase() !== 'NGN';
  if (existingCode && !shouldRotateRecipientCode) return existingCode;

  const bankCode = String(bankAccount?.bank_code || '').trim();
  if (!bankCode) {
    throw new Error('Paystack bank code is missing for this bank account');
  }

  const recipient = await createRecipient({
    name: String(bankAccount?.account_holder_name || '').trim(),
    accountNumber: String(bankAccount?.account_number || '').trim(),
    bankCode,
    currency: targetCurrency,
  });

  if (isUuidLike(bankAccount?.id)) {
    await supabaseAdmin
      .from('business_bank_accounts')
      .update({
        currency: targetCurrency,
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
  const countryCode = String(payload?.countryCode || '').trim().toUpperCase();
  const currency = countryCode === 'NG'
    ? 'NGN'
    : (String(payload?.currency || 'NGN').trim().toUpperCase() || 'NGN');

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
    country_code: countryCode || null,
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

const fetchPaystackBalances = async () => {
  const response = await fetch('https://api.paystack.co/balance', {
    method: 'GET',
    headers: paystackHeaders,
  });

  const body = await response.json();
  if (!response.ok || !body?.status) {
    return [];
  }

  const list = Array.isArray(body?.data) ? body.data : [];
  return list.map((item: any) => ({
    currency: String(item?.currency || '').trim().toUpperCase(),
    balance: Number(item?.balance || 0),
  }));
};

const isCompletedTransferStatus = (status: string) => String(status || '').trim().toLowerCase() === 'success';

const mapTransferStatusToTxStatus = (status: string): 'completed' | 'pending' =>
  isCompletedTransferStatus(status) ? 'completed' : 'pending';

const isCompletedLike = (status?: string) => {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'completed' || normalized === 'success' || normalized === 'successful' || normalized === 'paid';
};

const calculateWithdrawableBalance = (transactions: any[]) => {
  return Number(
    transactions.reduce((sum, tx) => {
      if (!isCompletedLike(tx?.status)) return sum;

      const amount = Number(tx?.amount || 0);
      const metadata = tx?.metadata && typeof tx.metadata === 'object' ? tx.metadata : {};
      const entry = String(metadata.entry || '').trim();

      if (entry === 'owner_credit') {
        return sum + Math.max(0, amount);
      }

      if (entry === 'owner_withdrawal' || tx?.type === 'withdrawal') {
        return sum - Math.abs(amount);
      }

      return sum;
    }, 0).toFixed(2)
  );
};

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

  const { data: ledgerRows, error: ledgerError } = await supabaseAdmin
    .from('transactions')
    .select('amount,type,status,metadata,created_at')
    .eq('wallet_id', wallet.id)
    .order('created_at', { ascending: false })
    .limit(500);

  if (ledgerError) {
    throw new Error(`Failed to load wallet ledger for withdrawal: ${ledgerError.message}`);
  }

  const ledgerBalance = calculateWithdrawableBalance((ledgerRows || []) as any[]);
  const currentBalance = Math.max(Number(wallet.balance || 0), ledgerBalance);

  console.error(`[WITHDRAWAL DEBUG] wallet.id=${wallet.id}, wallet.balance=${wallet.balance}, ledgerTransactions=${ledgerRows?.length || 0}, ledgerBalance=${ledgerBalance}, currentBalance=${currentBalance}, amount=${amount}`);

  if (currentBalance < amount) {
    throw new Error(`Insufficient balance: currentBalance=${currentBalance}, requested=${amount}, wallet.balance=${wallet.balance}, ledgerBalance=${ledgerBalance}`);
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return respond({ success: false, error: 'Missing bearer token' });
    }

    const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !userData?.user) {
      return respond({ success: false, error: 'Unauthorized' });
    }

    const payload = await req.json();
    const amount = Number(payload?.amount || 0);
    const businessBankAccountId = String(payload?.businessBankAccountId || '').trim();
    const withdrawalRequestId = String(payload?.withdrawalRequestId || '').trim();
    const countryCode = String(payload?.countryCode || '').trim().toUpperCase();

    if (!Number.isFinite(amount) || amount <= 0) {
      return respond({ success: false, error: 'amount must be a positive number' });
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
      throw new Error('No active business bank account found for this transfer');
    }

    if (String(effectiveBankAccount.payout_provider || '').toLowerCase() !== 'paystack' || countryCode !== 'NG') {
      throw new Error('This direct transfer route is only for Nigerian Paystack payout accounts');
    }

    if (effectiveBankAccount.is_verified !== true) {
      throw new Error('Paystack bank account is not verified yet');
    }

    const recipient = await ensureRecipientCode(effectiveBankAccount);
    if (!recipient) {
      throw new Error('Unable to resolve a Paystack transfer recipient');
    }

    const reference = String(payload?.reference || `transfer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    let transfer: any = null;
    let transferStatus = 'processing';
    let queuedForProviderBalance = false;
    let paystackBalances: Array<{ currency: string; balance: number }> = [];

    try {
      transfer = await createTransfer({
        recipient,
        amount: Math.round(amount * 100),
        reason: `Direct transfer for ${userData.user.id}`,
        reference,
      });
      transferStatus = String(transfer?.status || '').toLowerCase() || 'processing';
    } catch (transferError: any) {
      const message = String(transferError?.message || 'Failed to create Paystack transfer');
      if (/not enough to fulfil this request/i.test(message)) {
        queuedForProviderBalance = true;
        transferStatus = 'queued';
        paystackBalances = await fetchPaystackBalances();
      } else {
        throw transferError;
      }
    }

    const transferCompleted = isCompletedTransferStatus(transferStatus);
    let walletReservation: { txId?: string; balanceAfter?: number; alreadyRecorded?: boolean } | null = null;
    if (!queuedForProviderBalance && transferCompleted) {
      walletReservation = await reserveWalletFundsForWithdrawal({
        userId: userData.user.id,
        amount,
        transferStatus,
        transfer,
        reference,
        withdrawalRequestId: withdrawalRequestId || undefined,
      });
    }

    if (withdrawalRequestId) {
      const withdrawalStatus = queuedForProviderBalance
        ? 'pending'
        : (transferCompleted ? 'completed' : 'processing');

      await supabaseAdmin
        .from('withdrawal_requests')
        .update({
          status: withdrawalStatus,
          processed_at: isCompletedTransferStatus(transferStatus) ? new Date().toISOString() : null,
        })
        .eq('id', withdrawalRequestId)
        .eq('user_id', userData.user.id);
    }

    return respond({
      success: true,
      status: queuedForProviderBalance ? 'queued' : (transfer?.status || 'processing'),
      queuedForProviderBalance,
      transfer,
      recipient,
      reference,
      withdrawalTransactionId: walletReservation?.txId,
      walletBalanceAfter: walletReservation?.balanceAfter,
      alreadyRecorded: walletReservation?.alreadyRecorded,
      paystackBalances,
    });
  } catch (error: any) {
    console.error('paystack-direct-transfer error:', error);
    return respond({
      success: false,
      status: 'failed',
      error: error?.message || 'Paystack direct transfer failed.',
    });
  }
});
