import { z } from 'zod';
import { publicProcedure } from '../../../create-context';
import { supabase } from '@/backend/lib/supabase';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_330eb515e3709b9f2b60dfd11c9c7396aba4fcf5';
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

export const initializePaymentProcedure = publicProcedure
  .input(z.object({
    email: z.string().email(),
    amount: z.number().positive(), // Amount in dollars
    currency: z.string().default('NGN'), // Paystack default currency
    reference: z.string().optional(),
    callback_url: z.string().optional(),
    metadata: z.record(z.any()).optional(),
    channels: z.array(z.string()).optional(),
    split_code: z.string().optional(),
    subaccount: z.string().optional(),
    transaction_charge: z.number().optional(),
    bearer: z.enum(['account', 'subaccount']).optional(),
    // Additional fields for Supabase integration
    userId: z.string().optional(),
    orderId: z.string().optional(),
    walletId: z.string().optional(),
    paymentType: z.enum(['order_payment', 'wallet_funding']).default('order_payment'),
  }))
  .mutation(async ({ input }) => {
    try {
      // Convert amount to kobo (Paystack uses kobo for NGN, cents for USD)
      const amountInMinorUnit = Math.round(input.amount * 100);

      const normalizedSubaccount = String(input.subaccount || '').trim();
      const normalizedSplitCode = String(input.split_code || '').trim();
      // Paystack expects subaccount for one beneficiary and split_code for split groups.
      // Prefer subaccount if both are present so single-split flow remains valid.
      const effectiveSubaccount = normalizedSubaccount || undefined;
      const effectiveSplitCode = effectiveSubaccount ? undefined : (normalizedSplitCode || undefined);
      
      // Generate reference if not provided
      const reference = input.reference || `60seconds_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const payload = {
        email: input.email,
        amount: amountInMinorUnit,
        currency: input.currency,
        reference,
        callback_url: input.callback_url,
        metadata: {
          ...input.metadata,
          app_name: '60Seconds',
          timestamp: new Date().toISOString(),
          userId: input.userId,
          orderId: input.orderId,
          walletId: input.walletId,
          paymentType: input.paymentType,
          split_mode: effectiveSubaccount ? 'single_subaccount' : (effectiveSplitCode ? 'split_group' : 'none'),
        },
        channels: input.channels || ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer'],
        split_code: effectiveSplitCode,
        subaccount: effectiveSubaccount,
        transaction_charge: input.transaction_charge,
        bearer: input.bearer || ((effectiveSubaccount || effectiveSplitCode) ? 'account' : undefined),
      };
      
      const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to initialize payment');
      }
      
      if (!data.status) {
        throw new Error(data.message || 'Payment initialization failed');
      }
      
      return {
        success: true,
        data: {
          authorization_url: data.data.authorization_url,
          access_code: data.data.access_code,
          reference: data.data.reference,
        },
      };
    } catch (error: any) {
      console.error('Paystack initialization error:', error);
      throw new Error(error.message || 'Failed to initialize payment');
    }
  });