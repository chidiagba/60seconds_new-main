import { z } from "zod";
import { disabledProcedure } from "../../../create-context";

const DATATRANS_MERCHANT_ID = process.env.DATATRANS_MERCHANT_ID || '1110020919';
const DATATRANS_PASSWORD = process.env.DATATRANS_PASSWORD || '';
const DATATRANS_BASE_URL = process.env.DATATRANS_BASE_URL || 'https://api.datatrans.com';

export const verifyPaymentProcedure = disabledProcedure
  .input(
    z.object({
      transactionId: z.string(),
    })
  )
  .mutation(async ({ input }) => {
    try {
      const authString = Buffer.from(`${DATATRANS_MERCHANT_ID}:${DATATRANS_PASSWORD}`).toString('base64');

      const response = await fetch(`${DATATRANS_BASE_URL}/v1/transactions/${input.transactionId}`, {
        method: "GET",
        headers: {
          Authorization: `Basic ${authString}`,
          "Accept": "application/json",
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || data.error || "Failed to verify Datatrans payment"
        );
      }

      // Map Datatrans status to our status format
      let status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'EXPIRED' = 'PENDING';
      if (data.status === 'authorized' || data.status === 'settled') {
        status = 'SUCCESS';
      } else if (data.status === 'failed' || data.status === 'error') {
        status = 'FAILED';
      } else if (data.status === 'cancelled') {
        status = 'CANCELLED';
      } else if (data.status === 'expired') {
        status = 'EXPIRED';
      }

      return {
        success: true,
        data: {
          transactionId: data.transactionId || input.transactionId,
          orderId: data.refno || data.orderId,
          amount: data.amount ? data.amount / 100 : 0, // Convert from cents
          currency: data.currency || 'CHF',
          status: status,
          gatewayResponse: data,
          paidAt: data.settledAt || data.authorizedAt,
          createdAt: data.createdAt || new Date().toISOString(),
          customer: {
            email: data.email || '',
            name: data.cardholder || '',
          },
          metadata: data.metadata || {},
        },
      };
    } catch (error: any) {
      console.error("Datatrans verification error:", error);
      throw new Error(
        error.message || "Failed to verify Datatrans payment"
      );
    }
  });

