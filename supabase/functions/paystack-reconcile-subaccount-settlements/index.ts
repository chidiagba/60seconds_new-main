// @ts-nocheck
import { calculateOwnerWalletBalance } from '../_shared/owner-wallet-balance.ts';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const paystackKey = Deno.env.get('PAYSTACK_SECRET_KEY') || '';
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const completed = (value: unknown) => ['success', 'successful', 'completed', 'paid'].includes(String(value || '').toLowerCase());
const pending = (value: unknown) => ['pending', 'processing', 'in_progress'].includes(String(value || '').toLowerCase());
const money = (kobo: unknown) => Number((Number(kobo || 0) / 100).toFixed(2));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (!supabaseUrl || !serviceKey || !paystackKey) throw new Error('Settlement reconciliation is not configured');
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData?.user?.id) return reply({ success: false, error: 'Unauthorized' }, 401);
    const userId = authData.user.id;
    const body = await req.json().catch(() => ({}));
    const days = Math.min(365, Math.max(1, Number(body?.days || 90)));

    // Select the whole row because older production schemas may not yet have
    // the Paystack routing columns. Explicitly selecting a missing column makes
    // PostgREST reject the entire reconciliation before the fallback can run.
    const { data: bank, error: bankError } = await admin.from('business_bank_accounts')
      .select('*')
      .eq('user_id', userId).eq('is_primary', true).maybeSingle();
    if (bankError) throw new Error(`Could not load linked bank: ${bankError.message}`);

    const { data: ownerAuth } = await admin.auth.admin.getUserById(userId);
    const authBank = ownerAuth?.user?.user_metadata?.business_bank_account || {};
    const bankMetadata = bank?.metadata && typeof bank.metadata === 'object' ? bank.metadata : {};
    const subaccountId = bank?.paystack_subaccount_id || bankMetadata?.paystack_subaccount_id || authBank?.paystack_subaccount_id;
    const subaccountCode = bank?.paystack_subaccount_code || bankMetadata?.paystack_subaccount_code || authBank?.paystack_subaccount_code;
    const subaccount = subaccountId || subaccountCode;
    const accountNumber = String(bank?.account_number || authBank?.account_number || '').replace(/\D/g, '');
    const { data: wallet, error: walletError } = await admin.from('wallets').select('id,balance').eq('user_id', userId).maybeSingle();
    if (walletError || !wallet?.id) throw new Error(walletError?.message || 'Wallet not found');

    let settlements: any[] = [];
    if (subaccount || accountNumber) {
      const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      for (let page = 1; page <= 10; page += 1) {
        const url = new URL('https://api.paystack.co/settlement');
        if (subaccount) url.searchParams.set('subaccount', String(subaccount));
        url.searchParams.set('from', from);
        url.searchParams.set('perPage', '100');
        url.searchParams.set('page', String(page));
        const response = await fetch(url, { headers: { Authorization: `Bearer ${paystackKey}` } });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.status === false) throw new Error(result?.message || `Paystack settlements request failed (${response.status})`);
        const pageRows = Array.isArray(result?.data) ? result.data : [];
        settlements.push(...pageRows);
        if (pageRows.length < 100) break;
      }

      // When legacy rows have no stored subaccount identifier, match only the
      // settlement whose Paystack subaccount owns the linked bank account.
      if (!subaccount && accountNumber) {
        settlements = settlements.filter((settlement) =>
          String(settlement?.subaccount?.account_number || '').replace(/\D/g, '') === accountNumber
        );
      }
    }

    let created = 0;
    let updated = 0;
    for (const settlement of settlements) {
      const settlementId = String(settlement?.id || settlement?.settlement_code || '');
      if (!settlementId) continue;
      const rawStatus = String(settlement?.status || '').toLowerCase();
      const txStatus = completed(rawStatus) ? 'completed' : pending(rawStatus) ? 'pending' : 'failed';
      const amount = money(settlement?.effective_amount ?? settlement?.total_amount);
      if (!(amount > 0)) continue;
      const metadata = {
        entry: 'paystack_bank_settlement', lifecycle_stage: txStatus === 'completed' ? 'settled_to_bank' : 'pending_bank_settlement',
        payout_provider: 'paystack', settlement_id: settlementId, settlement_code: settlement?.settlement_code || null,
        settlement_status: rawStatus, paystack_subaccount_id: subaccountId || settlement?.subaccount?.id || null,
        paystack_subaccount_code: subaccountCode || settlement?.subaccount?.subaccount_code || null, bank_name: bank?.bank_name || null,
        bank_account_ending: accountNumber.slice(-4) || null,
        total_amount: money(settlement?.total_amount), effective_amount: amount,
        total_fees: money(settlement?.total_fees), currency: settlement?.currency || 'NGN',
        settlement_date: settlement?.settlement_date || settlement?.paid_at || null,
        reconciled_at: new Date().toISOString(),
      };
      const { data: existing } = await admin.from('transactions').select('id,amount,status,metadata').eq('wallet_id', wallet.id)
        .eq('metadata->>entry', 'paystack_bank_settlement').eq('metadata->>settlement_id', settlementId).maybeSingle();
      const record = {
        amount, type: 'withdrawal', status: txStatus,
        description: txStatus === 'completed' ? 'Paystack bank settlement to connected account' : 'Bank settlement pending',
        transaction_fee: 0, metadata, updated_at: new Date().toISOString(),
      };
      if (existing?.id) {
        const existingGatewayStatus = String(existing?.metadata?.settlement_status || '').toLowerCase();
        const hasChanged =
          String(existing.status || '').toLowerCase() !== txStatus ||
          Math.abs(Number(existing.amount || 0) - amount) >= 0.01 ||
          existingGatewayStatus !== rawStatus;
        if (hasChanged) {
          const { error } = await admin.from('transactions').update(record).eq('id', existing.id);
          if (error) throw error;
          updated += 1;
        }
      } else {
        const createdAt = settlement?.settlement_date || settlement?.createdAt || settlement?.created_at || new Date().toISOString();
        const { error } = await admin.from('transactions').insert({ ...record, wallet_id: wallet.id, created_at: createdAt });
        if (error) throw error;
        created += 1;
      }
    }

    const { data: rows, error: ledgerError } = await admin.from('transactions').select('amount,type,status,metadata,created_at').eq('wallet_id', wallet.id);
    if (ledgerError) throw ledgerError;
    const balance = calculateOwnerWalletBalance(rows || []);
    if (Math.abs(Number(wallet.balance || 0) - balance) >= 0.01) {
      const { error: balanceError } = await admin.from('wallets').update({ balance, updated_at: new Date().toISOString() }).eq('id', wallet.id);
      if (balanceError) throw balanceError;
    }
    return reply({ success: true, subaccountLinked: Boolean(subaccount || accountNumber), scanned: settlements.length, created, updated, balance });
  } catch (error) {
    console.error('paystack-reconcile-subaccount-settlements:', error);
    // Return a readable reconciliation result so the client can report the
    // provider/schema issue while continuing to load the wallet screen.
    return reply({ success: false, error: error?.message || 'Settlement reconciliation failed' });
  }
});
