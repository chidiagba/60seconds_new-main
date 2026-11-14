import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure } from '../../../create-context';
import { requiredEnv } from '../../../../lib/env';
const secret = requiredEnv('PAYSTACK_SECRET_KEY');
export const verifyPaymentProcedure = protectedProcedure.input(z.object({ reference: z.string().min(1).max(200) })).query(async ({ input, ctx }) => {
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(input.reference)}`, { headers: { Authorization: `Bearer ${secret}` } });
  if (!response.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
  const result = await response.json();
  const transaction = result.data;
  if (!result.status || !transaction || transaction.metadata?.userId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Payment is unavailable' });
  // Verification is read-only. Only the authenticated provider webhook settles funds.
  return { success: true, data: { reference: transaction.reference, status: transaction.status, amount: transaction.amount / 100, currency: transaction.currency, transactionId: String(transaction.id), customer: { email: ctx.user.email }, metadata: transaction.metadata, paidAt: transaction.paid_at, createdAt: transaction.created_at } };
});
