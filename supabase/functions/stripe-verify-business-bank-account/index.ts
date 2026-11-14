// @ts-nocheck
import { corsForRequest } from '../_shared/cors.ts';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';



const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
const supabaseUrl =
  Deno.env.get('SUPABASE_URL') ||
  `https://${Deno.env.get('SUPABASE_PROJECT_REF') || 'rvvujgbaswecqohixgog'}.supabase.co`;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

if (!stripeSecretKey) {
  throw new Error('Missing STRIPE_SECRET_KEY');
}

if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
  throw new Error('Missing Supabase env for stripe-verify-business-bank-account');
}

const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const getMetaValue = (obj: any, keys: string[]): string | null => {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const persistConnectedAccountId = async (userId: string, connectedAccountId: string, authUser: any) => {
  await supabaseAdmin
    .from('profiles')
    .update({ stripe_connected_account_id: connectedAccountId })
    .eq('id', userId);

  try {
    const userMeta = (authUser?.user_metadata || {}) as Record<string, any>;
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...userMeta,
        stripe_connected_account_id: connectedAccountId,
        stripe_account_id: connectedAccountId,
      },
    });
  } catch (metaError) {
    console.warn('Unable to persist stripe account id in auth metadata:', metaError);
  }
};

const resolveConnectedAccountId = async (userId: string, authUser: any, payload: any): Promise<string | null> => {
  const direct = getMetaValue(payload, ['connectedAccountId', 'stripeConnectedAccountId', 'stripe_account_id']);
  if (direct) return direct;

  const userMeta = authUser?.user_metadata || {};
  const appMeta = authUser?.app_metadata || {};

  const fromMeta =
    getMetaValue(userMeta, ['stripe_connected_account_id', 'stripe_account_id', 'connected_account_id']) ||
    getMetaValue(appMeta, ['stripe_connected_account_id', 'stripe_account_id', 'connected_account_id']);

  if (fromMeta) return fromMeta;

  const { data: profileRow, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (!profileError && profileRow) {
    const fromProfile = getMetaValue(profileRow as any, [
      'stripe_connected_account_id',
      'stripe_account_id',
      'connected_account_id',
      'owner_stripe_account_id',
    ]);

    if (fromProfile) return fromProfile;
  }

  return null;
};

const ensureConnectedAccountId = async (userId: string, authUser: any, payload: any): Promise<string | null> => {
  const existing = await resolveConnectedAccountId(userId, authUser, payload);
  if (existing) {
    return existing;
  }

  const country = deriveCountryCode(payload);

  const createdAccount = await stripe.accounts.create({
    type: 'express',
    country,
    email: authUser?.email || undefined,
    business_type: 'company',
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: {
      user_id: userId,
      source: 'bank_verification_auto_create',
    },
  } as any);

  const createdId = String(createdAccount?.id || '').trim();
  if (!createdId) {
    return null;
  }

  await persistConnectedAccountId(userId, createdId, authUser);
  return createdId;
};

const deriveCountryCode = (payload: any): string => {
  const explicitCode = getMetaValue(payload, ['countryCode', 'country_code']);
  if (explicitCode) return explicitCode.toUpperCase();

  const iban = String(payload?.iban || '').trim().toUpperCase();
  if (/^[A-Z]{2}/.test(iban)) {
    return iban.slice(0, 2);
  }

  return 'US';
};

const mapVerificationFromStripe = (bankAccount: any, connectedAccount?: any) => {
  const status = String(bankAccount?.status || '').toLowerCase();
  const disabledReason = connectedAccount?.requirements?.disabled_reason || connectedAccount?.future_requirements?.disabled_reason;

  if (status === 'verified' || status === 'validated') {
    return {
      verified: true,
      verificationStatus: 'verified',
      verificationReason: null,
    };
  }

  if (status === 'errored' || status === 'verification_failed') {
    return {
      verified: false,
      verificationStatus: 'failed',
      verificationReason: disabledReason || 'Stripe rejected this bank account. Check account details and try again.',
    };
  }

  return {
    verified: false,
    verificationStatus: 'pending',
    verificationReason: disabledReason || 'Stripe is reviewing bank account verification.',
  };
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

    const { data: userData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = userData.user.id;
    const payload = await req.json();

    const connectedAccountId = await ensureConnectedAccountId(userId, userData.user, payload);
    if (!connectedAccountId) {
      return new Response(
        JSON.stringify({
          verified: false,
          verificationStatus: 'failed',
          verificationReason: 'Stripe Connected account not found. Complete Stripe onboarding first.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const refreshOnly = payload?.refreshOnly === true;
    const externalAccountId = String(payload?.stripeExternalAccountId || '').trim();

    if (refreshOnly && externalAccountId) {
      const connectedAccount = await stripe.accounts.retrieve(connectedAccountId);
      const external = await stripe.accounts.retrieveExternalAccount(connectedAccountId, externalAccountId);
      const result = mapVerificationFromStripe(external, connectedAccount);

      return new Response(
        JSON.stringify({
          ...result,
          stripeConnectedAccountId: connectedAccountId,
          stripeExternalAccountId: externalAccountId,
          stripeExternalStatus: external?.status || null,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const accountHolderName = String(payload?.accountName || '').trim();
    const routingNumber = String(payload?.routingNumber || '').trim();
    const iban = String(payload?.iban || '').trim();
    const accountNumber = String(payload?.accountNumber || '').trim();
    const currency = String(payload?.currency || 'usd').trim().toLowerCase();
    const country = deriveCountryCode(payload);

    if (!accountHolderName) {
      return new Response(JSON.stringify({ error: 'accountName is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!iban && !accountNumber) {
      return new Response(JSON.stringify({ error: 'IBAN or accountNumber is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const externalBank = await stripe.accounts.createExternalAccount(connectedAccountId, {
      external_account: {
        object: 'bank_account',
        country,
        currency,
        account_holder_name: accountHolderName,
        account_holder_type: 'company',
        account_number: iban || accountNumber,
        ...(routingNumber ? { routing_number: routingNumber } : {}),
      },
      default_for_currency: true,
    } as any);

    const connectedAccount = await stripe.accounts.retrieve(connectedAccountId);
    const result = mapVerificationFromStripe(externalBank, connectedAccount);

    return new Response(
      JSON.stringify({
        ...result,
        stripeConnectedAccountId: connectedAccountId,
        stripeExternalAccountId: externalBank?.id || null,
        stripeExternalStatus: externalBank?.status || null,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('stripe-verify-business-bank-account error:', error);
    return new Response(
      JSON.stringify({
        verified: false,
        verificationStatus: 'failed',
        verificationReason: error?.message || 'Stripe verification failed.',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
