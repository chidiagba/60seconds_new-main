import { supabase } from '@/lib/supabase';

export type ExternalSettlementProvider = 'paystack' | 'twint' | 'worldline';

type SettlementItem = {
  productId?: string;
  quantity?: number;
  unitPrice?: number;
  currency?: string;
  ownerId?: string | null;
};

type SettleExternalOrderPaymentInput = {
  orderId: string;
  provider: ExternalSettlementProvider;
  paymentReference?: string | null;
  paymentTransactionId?: string | null;
  recipientId?: string | null;
  grossAmount?: number;
  netAmount?: number;
  currency?: string;
  videoId?: string | null;
  items?: SettlementItem[];
  metadata?: Record<string, any>;
};

export type ExternalSettlementResult = {
  success: boolean;
  alreadySettled?: boolean;
  orderId?: string;
  ownerId?: string;
  ownerWalletId?: string;
  grossAmount?: number;
  platformFeeAmount?: number;
  netAmount?: number;
  ownerWalletBalance?: number;
  error?: string;
};

export const settleExternalOrderPayment = async (
  input: SettleExternalOrderPaymentInput
): Promise<ExternalSettlementResult> => {
  const { data, error } = await supabase.functions.invoke('settle-external-order-payment', {
    body: {
      orderId: input.orderId,
      provider: input.provider,
      paymentReference: input.paymentReference || null,
      paymentTransactionId: input.paymentTransactionId || null,
      recipientId: input.recipientId || null,
      grossAmount: input.grossAmount,
      netAmount: input.netAmount,
      currency: input.currency,
      videoId: input.videoId || null,
      items: input.items || [],
      metadata: input.metadata || {},
    },
  });

  if (error) {
    return {
      success: false,
      error: error.message || 'Failed to settle external payment',
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
    orderId: data?.orderId,
    ownerId: data?.ownerId,
    ownerWalletId: data?.ownerWalletId,
    grossAmount: data?.grossAmount,
    platformFeeAmount: data?.platformFeeAmount,
    netAmount: data?.netAmount,
    ownerWalletBalance: data?.ownerWalletBalance,
  };
};