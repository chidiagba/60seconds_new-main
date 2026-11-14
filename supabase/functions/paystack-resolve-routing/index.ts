// @ts-nocheck
import { corsForRequest } from '../_shared/cors.ts';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';



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



const normalizeLower = (value: unknown) => String(value || '').trim().toLowerCase();
const normalizeUpper = (value: unknown) => String(value || '').trim().toUpperCase();
const asObject = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
const pickString = (...values: unknown[]) => {
  for (const value of values) {
    const next = String(value || '').trim();
    if (next) return next;
  }
  return '';
};

const extractBankRoutingMetadata = (input: unknown) => {
  const root = asObject(input);
  const embedded = asObject(root.business_bank_account);
  const source = Object.keys(embedded).length > 0 ? embedded : root;

  return {
    payoutProvider: pickString(source.payout_provider, source.payoutProvider) || null,
    countryCode: pickString(source.country_code, source.countryCode) || null,
    isVerified:
      source.is_verified === true || source.isVerified === true
        ? true
        : source.is_verified === false || source.isVerified === false
          ? false
          : null,
    verificationStatus: pickString(source.verification_status, source.verificationStatus) || null,
    verificationReason: pickString(source.verification_reason, source.verificationReason) || null,
    paystackSubaccountCode:
      pickString(source.paystack_subaccount_code, source.paystackSubaccountCode, source.subaccount) || null,
    paystackSplitCode: pickString(source.paystack_split_code, source.paystackSplitCode, source.split_code) || null,
    paystackRecipientCode: pickString(source.paystack_recipient_code, source.paystackRecipientCode) || null,
  };
};

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
  const corsHeaders = corsForRequest(req);
  const respond = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
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

    const selectCandidates = [
      'user_id,is_active,payout_provider,country_code,is_verified,verification_status,verification_reason,paystack_subaccount_code,paystack_recipient_code,paystack_split_code,metadata',
      'user_id,is_active,payout_provider,country_code,is_verified,verification_status,verification_reason,paystack_subaccount_code,paystack_recipient_code,metadata',
      'user_id,is_active,payout_provider,country_code,is_verified,verification_status,verification_reason,paystack_recipient_code,metadata',
      'user_id,is_active,payout_provider,country_code,is_verified,verification_status,verification_reason,paystack_recipient_code',
      'user_id,is_active,payout_provider,country_code,is_verified,verification_status,verification_reason',
    ];

    for (const selectClause of selectCandidates) {
      const { data, error } = await supabaseAdmin
        .from('business_bank_accounts')
        .select(selectClause)
        .eq('user_id', ownerId)
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(20);

      if (!error) {
        const rows = Array.isArray(data) ? data : [];
        // Prefer a Paystack-ready account over a newer active account for another
        // payout provider. This also recovers routes stored in the metadata fallback.
        bankRow = rows.find((row: any) => {
          const metadata = extractBankRoutingMetadata(asObject(row?.metadata));
          return Boolean(
            pickString(row?.paystack_subaccount_code, metadata.paystackSubaccountCode) ||
            pickString(row?.paystack_split_code, metadata.paystackSplitCode)
          );
        }) || rows[0] || null;
        bankError = null;
        break;
      }

      bankError = error;
      if (!/column|schema cache|does not exist/i.test(String(error.message || ''))) {
        break;
      }
    }

    if (bankError) {
      return respond({
        success: false,
        code: 'LOOKUP_FAILED',
        error: 'Request could not be completed',
        canUpdateBankDetails: ownerId === requesterId,
      });
    }

    const requesterMeta = extractBankRoutingMetadata((userData.user.user_metadata || {}) as Record<string, any>);
    const getOwnerMeta = async () => {
      if (ownerId === requesterId) {
        return requesterMeta;
      }

      const { data: ownerAuthData, error: ownerAuthError } = await supabaseAdmin.auth.admin.getUserById(ownerId);
      if (ownerAuthError || !ownerAuthData?.user) {
        return null;
      }

      return extractBankRoutingMetadata((ownerAuthData.user.user_metadata || {}) as Record<string, any>);
    };

    if (!bankRow) {
      const ownerMeta = await getOwnerMeta();
      if (ownerMeta && (ownerMeta.paystackSubaccountCode || ownerMeta.paystackSplitCode || ownerMeta.paystackRecipientCode)) {
        return respond(
          mapRoutingResponse({
            ownerId,
            requesterId,
            payoutProvider: ownerMeta.payoutProvider,
            countryCode: ownerMeta.countryCode,
            isVerified: ownerMeta.isVerified,
            verificationStatus: ownerMeta.verificationStatus,
            verificationReason: ownerMeta.verificationReason,
            paystackSubaccountCode: ownerMeta.paystackSubaccountCode,
            paystackSplitCode: ownerMeta.paystackSplitCode,
            paystackRecipientCode: ownerMeta.paystackRecipientCode,
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

    const rowMeta = extractBankRoutingMetadata(asObject(bankRow?.metadata));
    const ownerMeta = await getOwnerMeta();

    return respond(
      mapRoutingResponse({
        ownerId,
        requesterId,
        payoutProvider: pickString(bankRow.payout_provider, rowMeta.payoutProvider, ownerMeta?.payoutProvider) || null,
        countryCode: pickString(bankRow.country_code, rowMeta.countryCode, ownerMeta?.countryCode) || null,
        isVerified:
          bankRow.is_verified === true || bankRow.is_verified === false
            ? bankRow.is_verified === true
            : rowMeta.isVerified ?? ownerMeta?.isVerified ?? null,
        verificationStatus:
          pickString(bankRow.verification_status, rowMeta.verificationStatus, ownerMeta?.verificationStatus) || null,
        verificationReason:
          pickString(bankRow.verification_reason, rowMeta.verificationReason, ownerMeta?.verificationReason) || null,
        paystackSubaccountCode: pickString(
          bankRow.paystack_subaccount_code,
          rowMeta.paystackSubaccountCode,
          ownerMeta?.paystackSubaccountCode
        ) || null,
        paystackSplitCode: pickString(
          bankRow.paystack_split_code,
          rowMeta.paystackSplitCode,
          ownerMeta?.paystackSplitCode
        ) || null,
        paystackRecipientCode: pickString(
          bankRow.paystack_recipient_code,
          rowMeta.paystackRecipientCode,
          ownerMeta?.paystackRecipientCode
        ) || null,
      })
    );
  } catch (error: any) {
    console.error('paystack-resolve-routing error:', error);
    return respond({
      success: false,
      code: 'INTERNAL_ERROR',
      error: 'Request could not be completed',
    });
  }
});
