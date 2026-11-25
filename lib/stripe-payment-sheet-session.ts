import { logger } from '@/lib/logger';
import { supabase } from "@/lib/supabase";

type PaymentSheetSessionParams = {
  items?: Array<{productId:string;quantity:number}>;
  voucherCode?: string;
  voucherId?: string;
  requestKey?: string;
  amount: number;
  currency: string;
  platformFeeAmount: number;
  customerEmail?: string;
  productId?: string;
  productName?: string;
  paymentMethod?: string;
  connectedAccountId?: string | null;
};

type PaymentSheetSessionResponse = {
  paymentIntentClientSecret?: string;
  customerId?: string;
  ephemeralKeySecret?: string;
  totalAmount?: number;
  ownerId?: string | null;
  connectedAccountId?: string | null;
  sellerBankAccountId?: string | null;
  orderId?: string;
  completed?: boolean;
  order?: any;
  error?: string;
  message?: string;
};

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || '';

const SUPABASE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

const EDGE_TIMEOUT_MS = 15000;

const parseEdgePayload = (rawText: string): PaymentSheetSessionResponse => {
  if (!rawText) return {};

  try {
    return JSON.parse(rawText);
  } catch {
    return { error: rawText };
  }
};

const invokeEdgeFunction = async (
  functionName: string,
  body: Record<string, unknown>
): Promise<PaymentSheetSessionResponse> => {
  const { data: sessionData } = await supabase.auth.getSession();
  const bearerToken = sessionData.session?.access_token || SUPABASE_PUBLISHABLE_KEY;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), EDGE_TIMEOUT_MS)
    : null;

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });

    const rawText = await response.text();
    const payload = parseEdgePayload(rawText);

    if (!response.ok) {
      return {
        ...payload,
        error:
          payload.error ||
          payload.message ||
          `Edge Function returned status ${response.status}`,
      };
    }

    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { error: "Stripe payment session request timed out." };
    }

    return {
      error: error instanceof Error ? error.message : "Stripe payment session request failed.",
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export const createStripePaymentSheetSession = async (params: PaymentSheetSessionParams) => {
  const primary = await invokeEdgeFunction("stripe-create-checkout", params);

  if ((primary.paymentIntentClientSecret || (primary.completed && primary.order?.payment_status==='paid')) && !primary.error) {
    return primary;
  }

  if (params.items) throw new Error(primary.error || primary.message || "Server checkout could not be initialized");

  logger.warn("stripe-create-checkout failed, retrying with stripe-create-payment-sheet", primary);

  const fallback = await invokeEdgeFunction("stripe-create-payment-sheet", {
    amount: params.amount,
    currency: params.currency,
    customerEmail: params.customerEmail,
    productId: params.productId,
    productName: params.productName,
    platformFeeAmount: 0,
  });

  if (fallback.paymentIntentClientSecret && !fallback.error) {
    return fallback;
  }

  const primaryMessage = primary.error || primary.message || "stripe-create-checkout failed";
  const fallbackMessage = fallback.error || fallback.message || "stripe-create-payment-sheet failed";
  throw new Error(`${primaryMessage}. Fallback failed: ${fallbackMessage}`);
};