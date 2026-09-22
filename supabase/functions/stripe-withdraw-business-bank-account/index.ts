// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
const supabaseUrl =
  Deno.env.get('SUPABASE_URL') ||
  `https://${Deno.env.get('SUPABASE_PROJECT_REF') || 'rvvujgbaswecqohixgog'}.supabase.co`;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

if (!stripeSecretKey) throw new Error('Missing STRIPE_SECRET_KEY');
if (!supabaseUrl || !supabaseServiceKey) throw new Error('Missing Supabase env for stripe-withdraw-business-bank-account');

const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const respond = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const getMetaValue = (obj: any, keys: string[]): string | null => {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
};

const isCompletedPayoutStatus = (status: string) => {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'paid' || normalized === 'completed' || normalized === 'success';
};

const mapPayoutStatusToTxStatus = (status: string): 'completed' | 'pending' =>
  isCompletedPayoutStatus(status) ? 'completed' : 'pending';

const resolveConnectedAccountId = async (userId: string, authUser: any, payload: any): Promise<string | null> => {
  const direct = getMetaValue(payload, ['connectedAccountId', 'stripeConnectedAccountId', 'stripe_account_id']);
  if (direct) return direct;

  const userMeta = authUser?.user_metadata || {};
  const appMeta = authUser?.app_metadata || {};

  const fromMeta =
    getMetaValue(userMeta, ['stripe_connected_account_id', 'stripe_account_id', 'connected_account_id']) ||
    getMetaValue(appMeta, ['stripe_connected_account_id', 'stripe_account_id', 'connected_account_id']);

  if (fromMeta) return fromMeta;

  const { data: profileRow } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (profileRow) {
    const fromProfile = getMetaValue(profileRow, [
      'stripe_connected_account_id',
      'stripe_account_id',
      'connected_account_id',
      'owner_stripe_account_id',
    ]);

    if (fromProfile) return fromProfile;
  }

  return null;
};

const reserveWalletFundsForWithdrawal = async (params: {
  userId: string;
  amount: number;
  payoutStatus: string;
  payout: any;
  transfer: any;
  reference: string;
  connectedAccountId?: string | null;
  stripeExternalAccountId?: string | null;
  manualProcessing: boolean;
  withdrawalRequestId?: string;
}) => {
  const {
    userId,
    amount,
    payoutStatus,
    payout,
    transfer,
    reference,
    connectedAccountId,
    stripeExternalAccountId,
    manualProcessing,
    withdrawalRequestId,
  } = params;

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
      return {
        wallet,
        alreadyRecorded: true,
        balanceAfter: Number(wallet.balance || 0),
        txId: existingTx.id,
      };
    }
  }

  const currentBalance = Number(wallet.balance || 0);
  if (currentBalance < amount) {
    throw new Error('Insufficient withdrawable wallet balance');
  }

  const nextBalance = Number((currentBalance - amount).toFixed(2));
  const nowIso = new Date().toISOString();
  const txStatus = mapPayoutStatusToTxStatus(payoutStatus);

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
        payout_provider: 'stripe',
        withdrawal_request_id: withdrawalRequestId || null,
        stripe_transfer_id: transfer?.id ? String(transfer.id) : null,
        stripe_payout_id: payout?.id ? String(payout.id) : null,
        stripe_payout_status: payoutStatus,
        stripe_connected_account_id: connectedAccountId || null,
        stripe_external_account_id: stripeExternalAccountId || null,
        manual_processing: manualProcessing,
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

  return {
    wallet,
    alreadyRecorded: false,
    balanceAfter: nextBalance,
    txId: insertedTx.id,
  };
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
    const currency = String(payload?.currency || 'USD').trim().toLowerCase();

    if (!Number.isFinite(amount) || amount <= 0) {
      return respond({ success: false, error: 'amount must be a positive number' });
    }

    if (countryCode === 'NG') {
      return respond({
        success: false,
        error: 'Stripe withdrawal route is only for non-Nigerian accounts. Use Paystack route for Nigeria.',
        status: 'failed',
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

    if (bankAccount.is_verified !== true) {
      throw new Error('Stripe bank account is not verified yet');
    }

    const connectedAccountId = await resolveConnectedAccountId(userData.user.id, userData.user, payload);
    const stripeExternalAccountId =
      String(payload?.stripeExternalAccountId || '').trim() ||
      String(bankAccount?.stripe_external_account_id || '').trim();

    let transfer: any = null;
    let payout: any = null;
    let manualProcessing = false;
    let processingNote = '';

    const reference = String(payload?.reference || `stripe_withdraw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

    if (connectedAccountId && stripeExternalAccountId) {
      try {
        transfer = await stripe.transfers.create({
          amount: Math.round(amount * 100),
          currency,
          destination: connectedAccountId,
          metadata: {
            user_id: userData.user.id,
            withdrawal_request_id: withdrawalRequestId || '',
            reference,
          },
        });

        payout = await stripe.payouts.create(
          {
            amount: Math.round(amount * 100),
            currency,
            destination: stripeExternalAccountId,
            method: 'standard',
            metadata: {
              user_id: userData.user.id,
              withdrawal_request_id: withdrawalRequestId || '',
              transfer_id: transfer?.id || '',
              reference,
            },
          },
          {
            stripeAccount: connectedAccountId,
          }
        );
      } catch (stripeError: any) {
        manualProcessing = true;
        processingNote = stripeError?.message || 'Stripe payout call failed; queued for manual processing';
      }
    } else {
      manualProcessing = true;
      processingNote = 'Stripe account linkage is incomplete; queued for manual processing';
    }

    const payoutStatus = manualProcessing
      ? 'processing'
      : String(payout?.status || transfer?.status || '').toLowerCase() || 'processing';

    const walletReservation = await reserveWalletFundsForWithdrawal({
      userId: userData.user.id,
      amount,
      payoutStatus,
      payout,
      transfer,
      reference,
      connectedAccountId,
      stripeExternalAccountId,
      manualProcessing,
      withdrawalRequestId: withdrawalRequestId || undefined,
    });

    if (withdrawalRequestId) {
      const withdrawalStatus = isCompletedPayoutStatus(payoutStatus) ? 'completed' : 'processing';

      await supabaseAdmin
        .from('withdrawal_requests')
        .update({
          status: withdrawalStatus,
          processed_at: isCompletedPayoutStatus(payoutStatus) ? new Date().toISOString() : null,
        })
        .eq('id', withdrawalRequestId)
        .eq('user_id', userData.user.id);
    }

    return respond({
      success: true,
      status: payoutStatus,
      payout,
      transfer,
      reference,
      manualProcessing,
      processingNote: processingNote || null,
      withdrawalTransactionId: walletReservation.txId,
      walletBalanceAfter: walletReservation.balanceAfter,
      alreadyRecorded: walletReservation.alreadyRecorded,
    });
  } catch (error: any) {
    console.error('stripe-withdraw-business-bank-account error:', error);
    return respond({
      success: false,
      status: 'failed',
      error: error?.message || 'Stripe withdrawal request failed.',
    });
  }
});
