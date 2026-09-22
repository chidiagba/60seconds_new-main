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
if (!supabaseUrl || !supabaseServiceKey) throw new Error('Missing Supabase env for paystack-reconcile-withdrawals');

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

const isCompletedLike = (status?: string) => {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'completed' || normalized === 'success' || normalized === 'successful' || normalized === 'paid';
};

const calculateWithdrawableBalance = (transactions: any[]) => {
  return Number(
    transactions.reduce((sum, tx) => {
      const amount = Number(tx?.amount || 0);
      const metadata = tx?.metadata && typeof tx.metadata === 'object' ? tx.metadata : {};
      const entry = String(metadata.entry || '').trim();

      if ((entry === 'owner_withdrawal' || tx?.type === 'withdrawal') && isCompletedLike(tx?.status)) {
        return sum - Math.abs(amount);
      }

      if (!isCompletedLike(tx?.status)) return sum;

      if (entry === 'owner_credit') {
        return sum + Math.max(0, amount);
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
  withdrawalRequestId: string;
}) => {
  const { userId, amount, transferStatus, transfer, reference, withdrawalRequestId } = params;

  const { data: wallet, error: walletError } = await supabaseAdmin
    .from('wallets')
    .select('id,balance')
    .eq('user_id', userId)
    .maybeSingle();

  if (walletError) {
    throw new Error(`Failed to load wallet for withdrawal reconciliation: ${walletError.message}`);
  }

  if (!wallet?.id) {
    throw new Error('No wallet found for this user during withdrawal reconciliation');
  }

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

  const { data: ledgerRows, error: ledgerError } = await supabaseAdmin
    .from('transactions')
    .select('amount,type,status,metadata,created_at')
    .eq('wallet_id', wallet.id)
    .order('created_at', { ascending: false })
    .limit(500);

  if (ledgerError) {
    throw new Error(`Failed to load wallet ledger for reconciliation: ${ledgerError.message}`);
  }

  const ledgerBalance = calculateWithdrawableBalance((ledgerRows || []) as any[]);
  const currentBalance = Math.max(Number(wallet.balance || 0), ledgerBalance);

  if (currentBalance < amount) {
    throw new Error(`Insufficient wallet balance during reconciliation: current=${currentBalance}, requested=${amount}`);
  }

  const nextBalance = Number((currentBalance - amount).toFixed(2));
  const nowIso = new Date().toISOString();

  const { data: insertedTx, error: txError } = await supabaseAdmin
    .from('transactions')
    .insert({
      wallet_id: wallet.id,
      amount,
      type: 'withdrawal',
      status: 'completed',
      description: 'Wallet withdrawal to linked bank account',
      transaction_fee: 0,
      metadata: {
        entry: 'owner_withdrawal',
        payout_provider: 'paystack',
        withdrawal_request_id: withdrawalRequestId,
        paystack_transfer_id: transfer?.id ? String(transfer.id) : null,
        paystack_transfer_code: transfer?.transfer_code ? String(transfer.transfer_code) : null,
        paystack_status: transferStatus,
        reference,
        reconciled_by_job: true,
      },
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select('id')
    .single();

  if (txError || !insertedTx?.id) {
    throw new Error(`Failed to record reconciled withdrawal transaction: ${txError?.message || 'unknown error'}`);
  }

  const { error: walletUpdateError } = await supabaseAdmin
    .from('wallets')
    .update({ balance: nextBalance, updated_at: nowIso })
    .eq('id', wallet.id);

  if (walletUpdateError) {
    throw new Error(`Failed to update wallet balance during reconciliation: ${walletUpdateError.message}`);
  }

  return { wallet, alreadyRecorded: false, balanceAfter: nextBalance, txId: insertedTx.id };
};

const verifyTransfer = async (reference: string) => {
  const response = await fetch(`https://api.paystack.co/transfer/verify/${encodeURIComponent(reference)}`, {
    method: 'GET',
    headers: paystackHeaders,
  });

  const body = await response.json();
  if (!response.ok || !body?.status) {
    throw new Error(body?.message || 'Failed to verify Paystack transfer');
  }

  return body.data;
};

const listRecentSuccessfulTransfers = async () => {
  const response = await fetch('https://api.paystack.co/transfer?status=success&perPage=100&page=1', {
    method: 'GET',
    headers: paystackHeaders,
  });

  const body = await response.json();
  if (!response.ok || !body?.status) {
    throw new Error(body?.message || 'Failed to list Paystack transfers');
  }

  return Array.isArray(body?.data) ? body.data : [];
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
    if (authError || !userData?.user?.id) {
      return respond({ success: false, error: 'Unauthorized' });
    }

    const payload = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(payload?.limit || 20), 100));

    const { data: requests, error: requestsError } = await supabaseAdmin
      .from('withdrawal_requests')
      .select('id,user_id,amount,status,created_at')
      .eq('user_id', userData.user.id)
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: true })
      .limit(limit);

    if (requestsError) {
      throw new Error(`Failed to load pending withdrawal requests: ${requestsError.message}`);
    }

    let completed = 0;
    let recovered = 0;
    let pendingRecorded = 0;
    let failed = 0;
    let unchanged = 0;
    const updates: any[] = [];
    const successfulTransfers = await listRecentSuccessfulTransfers();

    for (const request of requests || []) {
      try {
        const requestAmountKobo = Math.round(Number(request.amount || 0) * 100);
        const requestCreatedAtMs = new Date(String(request.created_at || '')).getTime();
        const matchedTransfer = (successfulTransfers || [])
          .filter((transfer: any) => {
            const transferStatus = String(transfer?.status || '').trim().toLowerCase();
            if (transferStatus !== 'success') return false;

            const transferAmount = Number(transfer?.amount || 0);
            if (transferAmount !== requestAmountKobo) return false;

            const reason = String(transfer?.reason || '').trim();
            if (!reason.includes(request.user_id)) return false;

            const transferCreatedAtMs = new Date(String(transfer?.createdAt || transfer?.created_at || '')).getTime();
            if (!Number.isFinite(transferCreatedAtMs)) return false;

            // Match transfers created after this request and within a 7-day window.
            return transferCreatedAtMs >= requestCreatedAtMs && transferCreatedAtMs <= requestCreatedAtMs + 7 * 24 * 60 * 60 * 1000;
          })
          .sort((a: any, b: any) => {
            const bTime = new Date(String(b?.createdAt || b?.created_at || '')).getTime();
            const aTime = new Date(String(a?.createdAt || a?.created_at || '')).getTime();
            return bTime - aTime;
          })[0];

        if (!matchedTransfer) {
          const { data: wallet } = await supabaseAdmin
            .from('wallets')
            .select('id')
            .eq('user_id', request.user_id)
            .maybeSingle();
          if (wallet?.id) {
            const { data: existingPendingTx } = await supabaseAdmin
              .from('transactions')
              .select('id')
              .eq('wallet_id', wallet.id)
              .eq('metadata->>entry', 'owner_withdrawal')
              .eq('metadata->>withdrawal_request_id', request.id)
              .limit(1);
            if (!(existingPendingTx || []).length) {
              const { error: pendingInsertError } = await supabaseAdmin.from('transactions').insert({
                wallet_id: wallet.id,
                amount: Number(request.amount || 0),
                type: 'withdrawal',
                status: 'pending',
                description: 'Withdrawal request awaiting Paystack confirmation',
                transaction_fee: 0,
                metadata: {
                  entry: 'owner_withdrawal',
                  source: 'withdrawal_request_history_recovery',
                  payout_provider: 'paystack',
                  withdrawal_request_id: request.id,
                  paystack_status: 'processing',
                },
                created_at: request.created_at,
                updated_at: new Date().toISOString(),
              });
              if (!pendingInsertError) pendingRecorded += 1;
            }
          }
          unchanged += 1;
          updates.push({ withdrawalRequestId: request.id, status: 'processing' });
          continue;
        }

        const transferStatus = String(matchedTransfer?.status || '').trim().toLowerCase();

        if (transferStatus === 'success') {
          const walletReservation = await reserveWalletFundsForWithdrawal({
            userId: request.user_id,
            amount: Number(request.amount || 0),
            transferStatus,
            transfer: matchedTransfer,
            reference: String(matchedTransfer?.reference || '').trim(),
            withdrawalRequestId: request.id,
          });

          await supabaseAdmin
            .from('withdrawal_requests')
            .update({
              status: 'completed',
              processed_at: new Date().toISOString(),
              failure_reason: null,
            })
            .eq('id', request.id)
            .eq('user_id', request.user_id);

          completed += 1;
          updates.push({
            withdrawalRequestId: request.id,
            status: 'completed',
            withdrawalTransactionId: walletReservation?.txId,
          });
          continue;
        }

        if (transferStatus === 'failed' || transferStatus === 'reversed' || transferStatus === 'cancelled') {
          await supabaseAdmin
            .from('withdrawal_requests')
            .update({
              status: 'failed',
              failure_reason: `Paystack transfer ${transferStatus}`,
            })
            .eq('id', request.id)
            .eq('user_id', request.user_id);

          failed += 1;
          updates.push({ withdrawalRequestId: request.id, status: 'failed' });
          continue;
        }

        await supabaseAdmin
          .from('withdrawal_requests')
          .update({
            status: 'processing',
          })
          .eq('id', request.id)
          .eq('user_id', request.user_id);

        unchanged += 1;
        updates.push({ withdrawalRequestId: request.id, status: transferStatus || 'processing' });
      } catch (err: any) {
        unchanged += 1;
        updates.push({
          withdrawalRequestId: request.id,
          status: 'error',
          error: String(err?.message || 'reconciliation error'),
        });
      }
    }

    // Recover successful Paystack transfers that reached the bank but whose
    // withdrawal_request/ledger write was interrupted in an older app flow.
    const { data: bankAccount } = await supabaseAdmin
      .from('business_bank_accounts')
      .select('paystack_recipient_code')
      .eq('user_id', userData.user.id)
      .eq('is_active', true)
      .maybeSingle();
    const recipientCode = String(bankAccount?.paystack_recipient_code || '').trim();
    const { data: wallet } = await supabaseAdmin
      .from('wallets')
      .select('id')
      .eq('user_id', userData.user.id)
      .maybeSingle();

    if (wallet?.id && recipientCode) {
      for (const transfer of successfulTransfers) {
        const transferRecipientCode = String(
          transfer?.recipient?.recipient_code || transfer?.recipient_code || transfer?.recipient || ''
        ).trim();
        const reason = String(transfer?.reason || '');
        if (transferRecipientCode !== recipientCode && !reason.includes(userData.user.id)) continue;

        const reference = String(transfer?.reference || '').trim();
        const transferCode = String(transfer?.transfer_code || '').trim();
        if (!reference && !transferCode) continue;

        let existingQuery = supabaseAdmin
          .from('transactions')
          .select('id')
          .eq('wallet_id', wallet.id)
          .eq('metadata->>entry', 'owner_withdrawal');
        existingQuery = reference
          ? existingQuery.eq('metadata->>reference', reference)
          : existingQuery.eq('metadata->>paystack_transfer_code', transferCode);
        const { data: existing } = await existingQuery.limit(1);
        if ((existing || []).length) continue;

        const amount = Number(transfer?.amount || 0) / 100;
        if (!(amount > 0)) continue;
        const createdAt = transfer?.createdAt || transfer?.created_at || new Date().toISOString();
        const { error: insertError } = await supabaseAdmin.from('transactions').insert({
          wallet_id: wallet.id,
          amount: Number(amount.toFixed(2)),
          type: 'withdrawal',
          status: 'completed',
          description: 'Paystack transfer to linked bank account',
          transaction_fee: 0,
          metadata: {
            entry: 'owner_withdrawal',
            source: 'paystack_orphan_transfer_recovery',
            payout_provider: 'paystack',
            paystack_transfer_id: transfer?.id ? String(transfer.id) : null,
            paystack_transfer_code: transferCode || null,
            paystack_status: 'success',
            reference: reference || null,
            recipient_code: recipientCode,
            reconciled_at: new Date().toISOString(),
          },
          created_at: createdAt,
          updated_at: new Date().toISOString(),
        });
        if (!insertError) recovered += 1;
      }

      if (recovered > 0 || pendingRecorded > 0) {
        const { data: ledgerRows } = await supabaseAdmin
          .from('transactions')
          .select('amount,type,status,metadata')
          .eq('wallet_id', wallet.id);
        const nextBalance = calculateWithdrawableBalance(ledgerRows || []);
        await supabaseAdmin.from('wallets')
          .update({ balance: nextBalance, updated_at: new Date().toISOString() })
          .eq('id', wallet.id);
      }
    }

    return respond({
      success: true,
      scanned: (requests || []).length,
      completed,
      recovered,
      pendingRecorded,
      failed,
      unchanged,
      updates,
    });
  } catch (error: any) {
    console.error('paystack-reconcile-withdrawals error:', error);
    return respond({ success: false, error: error?.message || 'Reconciliation failed' });
  }
});
