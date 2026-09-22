import { createClient, SupabaseClient } from '@supabase/supabase-js';

type TraceArgs = {
  orderId?: string;
  reference?: string;
  provider?: string;
  buyerEmail?: string;
  buyerPassword?: string;
  organizerEmail?: string;
  organizerPassword?: string;
};

type SelectResult<T = any> = {
  data: T[] | null;
  error: any;
  usedColumns: string;
};

const DEFAULT_PROVIDER = 'paystack';
const PLATFORM_FEE_RATE = 0.04;

const parseArgs = (argv: string[]): TraceArgs => {
  const args: TraceArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) continue;

    switch (key) {
      case 'orderId':
      case 'reference':
      case 'provider':
      case 'buyerEmail':
      case 'buyerPassword':
      case 'organizerEmail':
      case 'organizerPassword':
        (args as any)[key] = value;
        i += 1;
        break;
      default:
        break;
    }
  }
  return args;
};

const roundMoney = (value: number) => Number(Number(value || 0).toFixed(2));

const expectedNetFromGross = (gross: number) => {
  if (!Number.isFinite(gross) || gross <= 0) return 0;
  return roundMoney(gross / (1 + PLATFORM_FEE_RATE));
};

const selectWithFallback = async (
  client: SupabaseClient,
  table: string,
  candidates: string[],
  applyQuery: (query: any) => any
): Promise<SelectResult> => {
  let lastError: any = null;

  for (const columns of candidates) {
    const result = await applyQuery(client.from(table).select(columns));
    if (!result.error) {
      return { data: (result.data || []) as any[], error: null, usedColumns: columns };
    }

    lastError = result.error;
    const message = String(result.error?.message || '').toLowerCase();
    const isColumnMismatch =
      message.includes('column') ||
      message.includes('schema cache') ||
      message.includes('does not exist');

    if (!isColumnMismatch) {
      return { data: null, error: result.error, usedColumns: columns };
    }
  }

  return { data: null, error: lastError, usedColumns: candidates[candidates.length - 1] || '*' };
};

const resolveOrderIdByReference = async (
  adminClient: SupabaseClient,
  reference: string,
  provider: string
): Promise<string | null> => {
  const lookupCandidates = [
    { key: 'metadata->>payment_reference', value: reference },
    { key: 'metadata->>payment_transaction_id', value: reference },
  ];

  for (const candidate of lookupCandidates) {
    const { data, error } = await adminClient
      .from('transactions')
      .select('metadata,created_at')
      .eq('metadata->>entry', 'owner_credit')
      .eq('metadata->>payment_provider', provider)
      .eq(candidate.key, candidate.value)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      throw new Error(`Failed reference lookup (${candidate.key}): ${error.message}`);
    }

    const row = (data || [])[0] as any;
    const orderId = String(row?.metadata?.order_id || row?.metadata?.orderId || '').trim();
    if (orderId) return orderId;
  }

  return null;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const provider = String(args.provider || DEFAULT_PROVIDER).toLowerCase();

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_URL.');
  }

  const hasServiceRole = Boolean(serviceRoleKey);
  const adminClient = hasServiceRole
    ? createClient(supabaseUrl, String(serviceRoleKey), { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

  let buyerClient: SupabaseClient | null = null;
  let organizerClient: SupabaseClient | null = null;

  if (!hasServiceRole) {
    if (!anonKey) {
      throw new Error('Missing EXPO_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY for user-auth trace mode.');
    }
    if (!args.buyerEmail || !args.buyerPassword || !args.organizerEmail || !args.organizerPassword) {
      throw new Error('Without SUPABASE_SERVICE_ROLE_KEY, provide --buyerEmail --buyerPassword --organizerEmail --organizerPassword.');
    }

    buyerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    organizerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const buyerSignIn = await buyerClient.auth.signInWithPassword({
      email: args.buyerEmail,
      password: args.buyerPassword,
    });
    if (buyerSignIn.error || !buyerSignIn.data.user) {
      throw new Error(`Buyer sign-in failed: ${buyerSignIn.error?.message || 'unknown error'}`);
    }

    const organizerSignIn = await organizerClient.auth.signInWithPassword({
      email: args.organizerEmail,
      password: args.organizerPassword,
    });
    if (organizerSignIn.error || !organizerSignIn.data.user) {
      throw new Error(`Organizer sign-in failed: ${organizerSignIn.error?.message || 'unknown error'}`);
    }
  }

  const orderReadClient = adminClient || buyerClient;
  const organizerReadClient = adminClient || organizerClient;

  if (!orderReadClient || !organizerReadClient) {
    throw new Error('Could not initialize Supabase clients for tracing.');
  }

  let orderId = String(args.orderId || '').trim() || null;
  if (!orderId && args.reference) {
    if (!adminClient) {
      throw new Error('Reference-only lookup requires SUPABASE_SERVICE_ROLE_KEY. Pass --orderId in user-auth mode.');
    }
    orderId = await resolveOrderIdByReference(adminClient, args.reference, provider);
    if (!orderId) {
      throw new Error(`No owner_credit transaction found for reference ${args.reference}.`);
    }
  }

  if (!orderId) {
    throw new Error('Provide --orderId (or --reference with service role key).');
  }

  const orderResult = await selectWithFallback(
    orderReadClient,
    'orders',
    [
      'id,user_id,business_id,total_amount,status,payment_method,payment_status,created_at,updated_at,items',
      'id,user_id,business_id,total_amount,status,payment_method,created_at,updated_at,items',
      '*',
    ],
    (query) => query.eq('id', orderId).limit(1)
  );

  if (orderResult.error || !(orderResult.data || []).length) {
    throw new Error(`Order lookup failed for ${orderId}: ${orderResult.error?.message || 'not found'}`);
  }
  const order = (orderResult.data || [])[0] as any;

  const ticketReceiptResult = await selectWithFallback(
    orderReadClient,
    'ticket_receipts',
    [
      'id,order_id,order_number,buyer_id,owner_id,product_id,unit_price,total_price,currency,issued_at,created_at',
      '*',
    ],
    (query) => query.eq('order_id', orderId).order('created_at', { ascending: true })
  );

  const paymentsResult = await selectWithFallback(
    orderReadClient,
    'payments',
    [
      'id,order_id,amount,currency,status,transaction_id,gateway_reference,processing_fee,net_amount,completed_at,created_at,metadata',
      '*',
    ],
    (query) => query.eq('order_id', orderId).order('created_at', { ascending: false })
  );

  const ownerCreditResult = await selectWithFallback(
    organizerReadClient,
    'transactions',
    ['id,wallet_id,amount,type,status,description,created_at,metadata', '*'],
    (query) =>
      query
        .eq('metadata->>entry', 'owner_credit')
        .eq('metadata->>order_id', orderId)
        .eq('metadata->>payment_provider', provider)
        .order('created_at', { ascending: false })
  );

  const buyerDebitResult = await selectWithFallback(
    organizerReadClient,
    'transactions',
    ['id,wallet_id,amount,type,status,description,created_at,metadata', '*'],
    (query) =>
      query
        .eq('metadata->>entry', 'buyer_debit')
        .eq('metadata->>order_id', orderId)
        .eq('metadata->>payment_provider', provider)
        .order('created_at', { ascending: false })
  );

  const ownerCredit = (ownerCreditResult.data || [])[0] as any;

  let ownerId = String(order.business_id || '').trim() || '';
  if (!ownerId && ownerCredit?.metadata) {
    ownerId = String(ownerCredit.metadata.owner_id || ownerCredit.metadata.ownerId || '').trim();
  }

  let ownerWallet: any = null;
  if (ownerId) {
    const walletResult = await selectWithFallback(
      organizerReadClient,
      'wallets',
      ['id,user_id,balance,currency,updated_at', '*'],
      (query) => query.eq('user_id', ownerId).limit(1)
    );

    if (!walletResult.error && (walletResult.data || []).length) {
      ownerWallet = walletResult.data?.[0] || null;
    }
  }

  const grossAmount = Number(order.total_amount || 0);
  const expectedNet = expectedNetFromGross(grossAmount);

  const summary = {
    tracedAt: new Date().toISOString(),
    mode: hasServiceRole ? 'service_role' : 'user_auth',
    input: {
      orderId,
      reference: args.reference || null,
      provider,
    },
    order,
    diagnostics: {
      orderColumnsUsed: orderResult.usedColumns,
      ticketReceiptsColumnsUsed: ticketReceiptResult.usedColumns,
      paymentsColumnsUsed: paymentsResult.usedColumns,
      ownerCreditColumnsUsed: ownerCreditResult.usedColumns,
      buyerDebitColumnsUsed: buyerDebitResult.usedColumns,
    },
    ticketReceipts: ticketReceiptResult.error ? { error: ticketReceiptResult.error.message } : ticketReceiptResult.data,
    payments: paymentsResult.error ? { error: paymentsResult.error.message } : paymentsResult.data,
    ownerCredits: ownerCreditResult.error ? { error: ownerCreditResult.error.message } : ownerCreditResult.data,
    buyerDebits: buyerDebitResult.error ? { error: buyerDebitResult.error.message } : buyerDebitResult.data,
    ownerWallet,
    computed: {
      orderGrossAmount: grossAmount,
      expectedNetAmountAt4PercentFee: expectedNet,
      expectedPlatformFee: roundMoney(Math.max(0, grossAmount - expectedNet)),
      ownerCreditAmountFound: ownerCredit ? Number(ownerCredit.amount || 0) : null,
      ownerCreditDeltaAgainstExpectedNet: ownerCredit ? roundMoney(Number(ownerCredit.amount || 0) - expectedNet) : null,
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  if (buyerClient) await buyerClient.auth.signOut();
  if (organizerClient) await organizerClient.auth.signOut();
};

main().catch((error) => {
  console.error(`Trace failed: ${error?.message || error}`);
  process.exitCode = 1;
});
