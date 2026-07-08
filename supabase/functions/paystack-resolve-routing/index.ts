// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const supabaseUrl =
  Deno.env.get('SUPABASE_URL') ||
  `https://${Deno.env.get('SUPABASE_PROJECT_REF') || ''}.supabase.co`;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment for paystack-resolve-routing');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const respond = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const normalizeLower = (value: unknown) => String(value || '').trim().toLowerCase();
const normalizeUpper = (value: unknown) => String(value || '').trim().toUpperCase();

const mapRoutingResponse = (input: {
  ownerId: string;
  requesterId: string;
  payoutProvider?: string | null;
  countryCode?: string | null;
  isVerified?: boolean | null;
  verificationStatus?: string | null;
  verificationReason?: string | null;
  paystackSubaccountCode?: string | null;
  paystackSplitCode?: string | null;
  paystackRecipientCode?: string | null;
}) => {
  const provider = normalizeLower(input.payoutProvider);
  const countryCode = normalizeUpper(input.countryCode);
  const isPaystackRoute = provider === 'paystack' || countryCode === 'NG';
  const verificationStatus = String(input.verificationStatus || '').trim().toLowerCase();
  const isVerified = input.isVerified === true;
  const subaccount = String(input.paystackSubaccountCode || '').trim();
  const splitCode = String(input.paystackSplitCode || '').trim();
  const recipientCode = String(input.paystackRecipientCode || '').trim();
  const hasSplitRouting = Boolean(subaccount || splitCode);

  const canUpdateBankDetails = input.ownerId === input.requesterId;

  if (!isPaystackRoute) {
    return {
      success: false,
      code: 'PAYSTACK_NOT_ENABLED',
      error: 'Organizer has not enabled Paystack payout routing for this account.',
      canUpdateBankDetails,
    };
  }

  if (!isVerified || verificationStatus === 'failed') {
    return {
      success: false,
      code: 'BANK_ACCOUNT_NOT_VERIFIED',
      error:
        input.verificationReason ||
        'Organizer bank account is not verified. Please update and verify bank details before checkout.',
      canUpdateBankDetails,
    };
  }

  if (!hasSplitRouting) {
    return {
      success: false,
      code: 'SPLIT_ROUTING_INCOMPLETE',
      error:
        'Organizer split routing is missing. Configure Paystack subaccount/split before checkout.',
      canUpdateBankDetails,
      routing: {
        subaccount: null,
        splitCode: null,
        recipientCode: recipientCode || null,
        bearer: 'account',
      },
    };
  }

  return {
    success: true,
    code: 'OK',
    canUpdateBankDetails,
    routing: {
      subaccount: subaccount || null,
      splitCode: splitCode || null,
      recipientCode: recipientCode || null,
      bearer: 'account',
    },
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
      return respond({ success: false, code: 'UNAUTHORIZED', error: 'Missing bearer token.' });
    }

    const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !userData?.user) {
      return respond({ success: false, code: 'UNAUTHORIZED', error: 'Unauthorized request.' });
    }

    const payload = await req.json().catch(() => ({}));
    const requesterId = String(userData.user.id || '').trim();
    const ownerId = String(payload?.ownerId || requesterId).trim();

    if (!ownerId) {
      return respond({ success: false, code: 'OWNER_REQUIRED', error: 'ownerId is required.' });
    }

    let bankRow: any = null;
    let bankError: any = null;

    ({ data: bankRow, error: bankError } = await supabaseAdmin
      .from('business_bank_accounts')
      .select(
        'user_id,is_active,payout_provider,country_code,is_verified,verification_status,verification_reason,paystack_subaccount_code,paystack_recipient_code,paystack_split_code'
      )
      .eq('user_id', ownerId)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle());

    if (bankError && /column|paystack_split_code|schema cache/i.test(String(bankError.message || ''))) {
      ({ data: bankRow, error: bankError } = await supabaseAdmin
        .from('business_bank_accounts')
        .select(
          'user_id,is_active,payout_provider,country_code,is_verified,verification_status,verification_reason,paystack_subaccount_code,paystack_recipient_code'
        )
        .eq('user_id', ownerId)
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle());
    }

    if (bankError) {
      return respond({
        success: false,
        code: 'LOOKUP_FAILED',
        error: `Could not resolve organizer payout routing: ${bankError.message}`,
        canUpdateBankDetails: ownerId === requesterId,
      });
    }

    if (!bankRow && ownerId === requesterId) {
      const metadata = (userData.user.user_metadata || {}) as Record<string, any>;
      const bankMeta = (metadata.business_bank_account || {}) as Record<string, any>;

      if (Object.keys(bankMeta).length > 0) {
        return respond(
          mapRoutingResponse({
            ownerId,
            requesterId,
            payoutProvider: bankMeta.payout_provider,
            countryCode: bankMeta.country_code,
            isVerified: bankMeta.is_verified === true,
            verificationStatus: bankMeta.verification_status,
            verificationReason: bankMeta.verification_reason,
            paystackSubaccountCode: bankMeta.paystack_subaccount_code || bankMeta.paystackSubaccountCode,
            paystackSplitCode: bankMeta.paystack_split_code || bankMeta.paystackSplitCode,
            paystackRecipientCode: bankMeta.paystack_recipient_code || bankMeta.paystackRecipientCode,
          })
        );
      }
    }

    if (!bankRow) {
      return respond({
        success: false,
        code: 'BANK_ACCOUNT_MISSING',
        error: 'Organizer has no active payout bank account configured yet.',
        canUpdateBankDetails: ownerId === requesterId,
      });
    }

    return respond(
      mapRoutingResponse({
        ownerId,
        requesterId,
        payoutProvider: bankRow.payout_provider,
        countryCode: bankRow.country_code,
        isVerified: bankRow.is_verified === true,
        verificationStatus: bankRow.verification_status,
        verificationReason: bankRow.verification_reason,
        paystackSubaccountCode: bankRow.paystack_subaccount_code,
        paystackSplitCode: bankRow.paystack_split_code,
        paystackRecipientCode: bankRow.paystack_recipient_code,
      })
    );
  } catch (error: any) {
    console.error('paystack-resolve-routing error:', error);
    return respond({
      success: false,
      code: 'INTERNAL_ERROR',
      error: error?.message || 'Unexpected error while resolving Paystack routing.',
    });
  }
});
