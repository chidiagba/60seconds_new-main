import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

type BankAccountRow = {
  id: string;
  user_id: string;
  payout_provider?: string | null;
  is_verified?: boolean | null;
  verification_status?: string | null;
  is_active?: boolean | null;
  bank_name?: string | null;
  bank_code?: string | null;
  account_holder_name?: string | null;
  account_number?: string | null;
  country_code?: string | null;
  currency?: string | null;
  paystack_subaccount_code?: string | null;
  paystack_subaccount_id?: string | null;
};

type PaystackSubaccount = {
  id: number;
  subaccount_code: string;
  business_name?: string;
  settlement_bank?: string;
  settlement_bank_code?: string;
  account_number?: string;
  active?: boolean | number;
};

type PaystackBank = {
  name: string;
  code: string;
};

const argv = process.argv.slice(2);
const shouldApply = argv.includes('--apply');
const dryRun = !shouldApply;
const userIdArg = argv.find((arg) => arg.startsWith('--user-id='));
const limitArg = argv.find((arg) => arg.startsWith('--limit='));
const userIdFilter = userIdArg ? userIdArg.split('=')[1]?.trim() : '';
const limit = Number(limitArg ? limitArg.split('=')[1] : 0) || 0;

const loadLocalEnv = () => {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;

    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['\"]|['\"]$/g, '');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
};

loadLocalEnv();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
}

if (!paystackSecretKey) {
  throw new Error('Missing PAYSTACK_SECRET_KEY.');
}

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

const toBool = (value: unknown, defaultValue = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  }
  return defaultValue;
};

const fetchPaystackBanks = async (): Promise<PaystackBank[]> => {
  const response = await fetch('https://api.paystack.co/bank?country=nigeria', {
    headers: paystackHeaders,
  });

  const body = await response.json();
  if (!response.ok || !body?.status) {
    throw new Error(body?.message || 'Failed to fetch Paystack banks');
  }

  return Array.isArray(body?.data)
    ? body.data
        .map((entry: any) => ({
          name: String(entry?.name || '').trim(),
          code: String(entry?.code || '').trim(),
        }))
        .filter((entry: PaystackBank) => entry.name && entry.code)
    : [];
};

const resolveBankCode = (bankName: string, providedCode: string, banks: PaystackBank[]) => {
  const direct = String(providedCode || '').trim();
  if (direct) return direct;

  const target = normalize(bankName);
  if (!target) return '';

  const exact = banks.find((entry) => normalize(entry.name) === target);
  if (exact) return exact.code;

  const fuzzy = banks.find((entry) => normalize(entry.name).includes(target) || target.includes(normalize(entry.name)));
  return fuzzy?.code || '';
};

const fetchAllSubaccounts = async (): Promise<PaystackSubaccount[]> => {
  const out: PaystackSubaccount[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await fetch(`https://api.paystack.co/subaccount?perPage=${perPage}&page=${page}`, {
      headers: paystackHeaders,
    });

    const body = await response.json();
    if (!response.ok || !body?.status) {
      throw new Error(body?.message || `Failed to fetch Paystack subaccounts page ${page}`);
    }

    const data = Array.isArray(body?.data) ? body.data : [];
    if (!data.length) break;

    out.push(...data);

    if (data.length < perPage) break;
    page += 1;
  }

  return out;
};

const createSubaccount = async (payload: {
  businessName: string;
  bankCode: string;
  accountNumber: string;
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

  return body.data as PaystackSubaccount;
};

const run = async () => {
  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'APPLY (writes enabled)'}`);
  if (userIdFilter) {
    console.log(`Filter: user_id = ${userIdFilter}`);
  }
  if (limit > 0) {
    console.log(`Limit: ${limit}`);
  }

  const banks = await fetchPaystackBanks();
  const subaccounts = await fetchAllSubaccounts();

  const subByCode = new Map<string, PaystackSubaccount>();
  const subByBankAndAccount = new Map<string, PaystackSubaccount>();

  for (const sub of subaccounts) {
    const code = String(sub.subaccount_code || '').trim();
    if (code) subByCode.set(code, sub);

    const acct = String(sub.account_number || '').trim();
    const bankCode = String(sub.settlement_bank_code || '').trim();
    if (acct && bankCode) {
      subByBankAndAccount.set(`${bankCode}:${acct}`, sub);
    }
  }

  let query = (supabaseAdmin as any)
    .from('business_bank_accounts')
    .select(
      'id,user_id,payout_provider,is_verified,verification_status,is_active,bank_name,bank_code,account_holder_name,account_number,country_code,currency,paystack_subaccount_code,paystack_subaccount_id'
    )
    .eq('payout_provider', 'paystack')
    .eq('is_verified', true)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (userIdFilter) query = query.eq('user_id', userIdFilter);
  if (limit > 0) query = query.limit(limit);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch business_bank_accounts: ${error.message}`);
  }

  const rows: BankAccountRow[] = Array.isArray(data) ? data : [];

  let processed = 0;
  let skipped = 0;
  let reusedExistingCode = 0;
  let reusedByBankAccount = 0;
  let created = 0;
  let updated = 0;
  const failures: Array<{ id: string; reason: string }> = [];

  for (const row of rows) {
    processed += 1;

    try {
      const countryCode = String(row.country_code || '').trim().toUpperCase();
      const accountNumber = String(row.account_number || '').trim();
      const bankName = String(row.bank_name || '').trim();
      const existingCode = String(row.paystack_subaccount_code || '').trim();
      const businessName = String(row.account_holder_name || `Business ${row.user_id}`).trim();

      if (countryCode && countryCode !== 'NG') {
        skipped += 1;
        console.log(`SKIP ${row.id}: country_code=${countryCode} is not NG`);
        continue;
      }

      if (!accountNumber || !bankName) {
        skipped += 1;
        console.log(`SKIP ${row.id}: missing account_number or bank_name`);
        continue;
      }

      const bankCode = resolveBankCode(bankName, String(row.bank_code || ''), banks);
      if (!bankCode) {
        throw new Error(`Unable to resolve bank code for bank_name=${bankName}`);
      }

      let subaccount: PaystackSubaccount | null = null;

      if (existingCode) {
        const existing = subByCode.get(existingCode);
        if (existing) {
          subaccount = existing;
          reusedExistingCode += 1;
        }
      }

      if (!subaccount) {
        const matched = subByBankAndAccount.get(`${bankCode}:${accountNumber}`) || null;
        if (matched) {
          subaccount = matched;
          reusedByBankAccount += 1;
        }
      }

      if (!subaccount) {
        if (dryRun) {
          console.log(`PLAN ${row.id}: would create subaccount for ${businessName} (${bankCode}:${accountNumber})`);
          created += 1;
          continue;
        }

        subaccount = await createSubaccount({
          businessName,
          bankCode,
          accountNumber,
          percentageCharge: 4,
        });

        created += 1;

        const subCode = String(subaccount.subaccount_code || '').trim();
        const subId = Number(subaccount.id || 0);
        if (subCode) subByCode.set(subCode, subaccount);
        if (subCode && bankCode && accountNumber) {
          subByBankAndAccount.set(`${bankCode}:${accountNumber}`, subaccount);
        }

        console.log(`CREATE ${row.id}: ${subCode} (${businessName})`);
      }

      if (!subaccount) {
        throw new Error('Subaccount resolution failed unexpectedly');
      }

      const resolvedCode = String(subaccount.subaccount_code || '').trim();
      const resolvedId = Number(subaccount.id || 0);
      const currentId = Number(row.paystack_subaccount_id || 0);
      const needsUpdate = row.paystack_subaccount_code !== resolvedCode || currentId !== resolvedId;

      if (!needsUpdate) {
        console.log(`OK ${row.id}: already synced ${resolvedCode}`);
        continue;
      }

      if (dryRun) {
        console.log(`PLAN ${row.id}: would update paystack_subaccount_code=${resolvedCode}`);
        updated += 1;
        continue;
      }

      const { error: updateError } = await (supabaseAdmin as any)
        .from('business_bank_accounts')
        .update({
          bank_code: bankCode,
          paystack_subaccount_code: resolvedCode,
          paystack_subaccount_id: resolvedId || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      if (updateError) {
        throw new Error(`Failed to update business_bank_accounts row: ${updateError.message}`);
      }

      updated += 1;
      console.log(`UPDATE ${row.id}: ${resolvedCode}`);
    } catch (error: any) {
      failures.push({ id: row.id, reason: error?.message || 'Unknown error' });
      console.error(`FAIL ${row.id}: ${error?.message || error}`);
    }
  }

  console.log('\nBackfill summary');
  console.log(`- processed: ${processed}`);
  console.log(`- skipped: ${skipped}`);
  console.log(`- reused existing code: ${reusedExistingCode}`);
  console.log(`- reused by bank+account: ${reusedByBankAccount}`);
  console.log(`- created: ${created}`);
  console.log(`- updated: ${updated}`);
  console.log(`- failures: ${failures.length}`);

  if (failures.length) {
    console.log('\nFailures');
    for (const failure of failures) {
      console.log(`- ${failure.id}: ${failure.reason}`);
    }
  }
};

run().catch((error) => {
  console.error('Backfill failed:', error?.message || error);
  process.exit(1);
});
