import { supabase } from '@/lib/supabase';

type SettlementItem = {
  productId: string;
  quantity?: number;
  unitPrice?: number;
  currency?: string;
  ownerId?: string | null;
};

type SettleStripePaymentInput = {
  paymentIntentClientSecret?: string;
  paymentIntentId?: string;
  orderId?: string;
  recipientId?: string | null;
  grossAmountCents?: number;
  platformFeeAmountCents?: number;
  currency?: string;
  videoId?: string;
  items?: SettlementItem[];
};

export type StripeSettlementResult = {
  success: boolean;
  alreadySettled?: boolean;
  paymentIntentId?: string;
  ownerId?: string;
  ownerWalletId?: string;
  grossAmount?: number;
  platformFeeAmount?: number;
  netAmount?: number;
  ownerWalletBalance?: number;
  error?: string;
};

const extractPaymentIntentId = (clientSecret?: string) => {
  if (!clientSecret) return null;
  const marker = '_secret_';
  const idx = clientSecret.indexOf(marker);
  if (idx <= 0) return null;
  return clientSecret.slice(0, idx);
};

export const settleStripePayment = async (
  input: SettleStripePaymentInput
): Promise<StripeSettlementResult> => {
  const paymentIntentId = input.paymentIntentId || extractPaymentIntentId(input.paymentIntentClientSecret || undefined);

  if (!paymentIntentId) {
    return {
      success: false,
      error: 'Missing Stripe payment intent id/client secret for settlement.',
    };
  }

  const { data, error } = await supabase.functions.invoke('stripe-confirm-and-settle', {
    body: {
      paymentIntentId,
      orderId: input.orderId,
      recipientId: input.recipientId || null,
      grossAmountCents: input.grossAmountCents,
      platformFeeAmountCents: input.platformFeeAmountCents,
      currency: input.currency,
      videoId: input.videoId,
      items: input.items || [],
    },
  });

  if (error) {
    return {
      success: false,
      error: error.message || 'Failed to settle Stripe payment',
    };
  }

  if (data?.error) {
    return {
      success: false,
      error: data.error,
    };
  }

  return {
    success: !!data?.success,
    alreadySettled: !!data?.alreadySettled,
    paymentIntentId: data?.paymentIntentId,
    ownerId: data?.ownerId,
    ownerWalletId: data?.ownerWalletId,
    grossAmount: data?.grossAmount,
    platformFeeAmount: data?.platformFeeAmount,
    netAmount: data?.netAmount,
    ownerWalletBalance: data?.ownerWalletBalance,
  };
};
