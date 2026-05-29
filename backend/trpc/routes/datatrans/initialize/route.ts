import { z } from "zod";
import { publicProcedure } from "../../../create-context";

const DATATRANS_MERCHANT_ID = process.env.DATATRANS_MERCHANT_ID || '1110020919';
const DATATRANS_PASSWORD = process.env.DATATRANS_PASSWORD || '';
const DATATRANS_BASE_URL = process.env.DATATRANS_BASE_URL || 'https://api.datatrans.com';

export const initializePaymentProcedure = publicProcedure
  .input(
    z.object({
      amount: z.number().positive(),
      currency: z.string().default("CHF"),
      orderId: z.string(),
      customerEmail: z.string().email(),
      customerName: z.string().optional(),
      description: z.string().optional(),
      returnUrl: z.string().optional(),
      cancelUrl: z.string().optional(),
      metadata: z.record(z.any()).optional(),
      userId: z.string().optional(),
      walletId: z.string().optional(),
      paymentType: z
        .enum(["order_payment", "wallet_funding"])
        .default("order_payment"),
    })
  )
  .mutation(async ({ input }) => {
    try {
      // Convert amount to cents
      const amountInCents = Math.round(input.amount * 100);

      // Generate transaction ID
      const transactionId = `60seconds_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      const payload = {
        amount: amountInCents,
        currency: input.currency,
        refno: input.orderId,
        email: input.customerEmail,
        language: 'en',
        successUrl: input.returnUrl || `${process.env.EXPO_PUBLIC_RORK_API_BASE_URL || 'http://localhost:3001'}/datatrans/success`,
        errorUrl: input.cancelUrl || `${process.env.EXPO_PUBLIC_RORK_API_BASE_URL || 'http://localhost:3001'}/datatrans/error`,
        cancelUrl: input.cancelUrl || `${process.env.EXPO_PUBLIC_RORK_API_BASE_URL || 'http://localhost:3001'}/datatrans/cancel`,
        metadata: {
          ...input.metadata,
          app_name: "60Seconds",
          timestamp: new Date().toISOString(),
          userId: input.userId,
          orderId: input.orderId,
          walletId: input.walletId,
          paymentType: input.paymentType,
        },
      };

      const authString = Buffer.from(`${DATATRANS_MERCHANT_ID}:${DATATRANS_PASSWORD}`).toString('base64');

      const response = await fetch(`${DATATRANS_BASE_URL}/v1/transactions`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${authString}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || data.error || "Failed to initialize Datatrans payment"
        );
      }

      return {
        success: true,
        data: {
          transactionId: data.transactionId || transactionId,
          redirectUrl: data.redirectUrl || data.redirect,
          orderId: input.orderId,
          amount: input.amount,
          currency: input.currency,
          status: data.status || "PENDING",
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes
        },
      };
    } catch (error: any) {
      console.error("Datatrans initialization error:", error);
      throw new Error(
        error.message || "Failed to initialize Datatrans payment"
      );
    }
  });

