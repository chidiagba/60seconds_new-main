import { z } from "zod";
import { publicProcedure } from "../../../create-context";
import { supabase } from "@/backend/lib/supabase";

// Worldline API Configuration - PSPID is the Merchant ID
const WORLDLINE_MERCHANT_ID =
  process.env.WORLDLINE_MERCHANT_ID || "60secondsTechnologies";
const WORLDLINE_API_KEY =
  process.env.WORLDLINE_API_KEY ||
  "43A1D436F54844DB73BF153ECBA9551A27636D945271483D0D0B62D713CDAB5C8B15F5158D9339FCA9EA4BD0C92678F94FC930FF3A3355BB1DC1856530B3D730";
const WORLDLINE_BASE_URL =
  process.env.WORLDLINE_BASE_URL ||
  "https://payment.direct.worldline-solutions.com/v2";

const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "myapp://payment";

export const initializePaymentProcedure = publicProcedure
  .input(
    z.object({
      amount: z.number().positive(), // Amount in dollars
      currency: z.string().default("USD"),
      orderId: z.string(),
      customerEmail: z.string().email(),
      customerName: z.string().optional(),
      description: z.string().optional(),
      returnUrl: z.string().optional(),
      cancelUrl: z.string().optional(),
      metadata: z.record(z.any()).optional(),
      // Additional fields for Supabase integration
      userId: z.string().optional(),
      walletId: z.string().optional(),
      paymentType: z
        .enum(["order_payment", "wallet_funding"])
        .default("order_payment"),
    })
  )
  .mutation(async ({ input }) => {
    try {
      // Convert amount to cents (Worldline uses cents for USD)
      const amountInCents = Math.round(input.amount * 100);

      // Generate payment ID
      const paymentId = `60seconds_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      const payload = {
        amount: amountInCents,
        currency: input.currency,
        orderId: input.orderId,
        paymentId: paymentId,
        customer: {
          email: input.customerEmail,
          name: input.customerName,
        },
        description: input.description || `Payment for order ${input.orderId}`,
        returnUrl:
          input.returnUrl ||
          `${APP_BASE_URL}/success`,
        cancelUrl:
          input.cancelUrl ||
          `${APP_BASE_URL}/cancel`,
        metadata: {
          ...input.metadata,
          app_name: "60Seconds",
          timestamp: new Date().toISOString(),
          userId: input.userId,
          orderId: input.orderId,
          walletId: input.walletId,
          paymentType: input.paymentType,
        },
        // Sandbox mode for testing
        testMode: process.env.NODE_ENV !== "production",
      };

      const response = await fetch(`${WORLDLINE_BASE_URL}/payments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WORLDLINE_API_KEY}`,
          "Content-Type": "application/json",
          "X-Merchant-Id": WORLDLINE_MERCHANT_ID,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Failed to initialize Worldline payment"
        );
      }

      if (!data.success) {
        throw new Error(
          data.message || "Worldline payment initialization failed"
        );
      }

      return {
        success: true,
        data: {
          paymentId: data.paymentId,
          redirectUrl: data.redirectUrl,
          orderId: input.orderId,
          amount: input.amount,
          currency: input.currency,
          status: data.status || "PENDING",
          expiresAt: data.expiresAt,
        },
      };
    } catch (error: any) {
      console.error("Worldline initialization error:", error);

      // For development/testing, return mock data
      if (process.env.NODE_ENV === "development") {
        console.log("Returning mock Worldline payment data for development");
        return {
          success: true,
          data: {
            paymentId: `mock_${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 9)}`,
            redirectUrl: `${APP_BASE_URL}/mock-success?paymentId=mock_${Date.now()}`,
            orderId: input.orderId,
            amount: input.amount,
            currency: input.currency,
            status: "PENDING",
            expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes
          },
        };
      }

      throw new Error(
        error.message || "Failed to initialize Worldline payment"
      );
    }
  });
