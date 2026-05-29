import { z } from 'zod';
import { publicProcedure } from '../../../create-context';
import crypto from 'crypto';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_your_secret_key_here';

// Webhook event types
const WEBHOOK_EVENTS = {
  CHARGE_SUCCESS: 'charge.success',
  CHARGE_FAILED: 'charge.failed',
  TRANSFER_SUCCESS: 'transfer.success',
  TRANSFER_FAILED: 'transfer.failed',
  SUBSCRIPTION_CREATE: 'subscription.create',
  SUBSCRIPTION_DISABLE: 'subscription.disable',
  INVOICE_CREATE: 'invoice.create',
  INVOICE_PAYMENT_FAILED: 'invoice.payment_failed',
} as const;

export const handleWebhookProcedure = publicProcedure
  .input(z.object({
    event: z.string(),
    data: z.record(z.any()),
    signature: z.string().optional(),
  }))
  .mutation(async ({ input }) => {
    try {
      // Verify webhook signature (in production)
      if (input.signature && process.env.NODE_ENV === 'production') {
        const hash = crypto
          .createHmac('sha512', PAYSTACK_SECRET_KEY)
          .update(JSON.stringify(input))
          .digest('hex');
        
        if (hash !== input.signature) {
          throw new Error('Invalid webhook signature');
        }
      }
      
      const { event, data } = input;
      
      console.log(`Processing Paystack webhook: ${event}`, data);
      
      switch (event) {
        case WEBHOOK_EVENTS.CHARGE_SUCCESS:
          await handleChargeSuccess(data);
          break;
          
        case WEBHOOK_EVENTS.CHARGE_FAILED:
          await handleChargeFailed(data);
          break;
          
        case WEBHOOK_EVENTS.TRANSFER_SUCCESS:
          await handleTransferSuccess(data);
          break;
          
        case WEBHOOK_EVENTS.TRANSFER_FAILED:
          await handleTransferFailed(data);
          break;
          
        default:
          console.log(`Unhandled webhook event: ${event}`);
      }
      
      return {
        success: true,
        message: 'Webhook processed successfully',
      };
    } catch (error: any) {
      console.error('Webhook processing error:', error);
      throw new Error(error.message || 'Failed to process webhook');
    }
  });

async function handleChargeSuccess(data: any) {
  // Handle successful payment
  console.log('Payment successful:', {
    reference: data.reference,
    amount: data.amount / 100,
    customer: data.customer.email,
    status: data.status,
  });
  
  // Here you would typically:
  // 1. Update user's wallet balance
  // 2. Create transaction record
  // 3. Send confirmation email/notification
  // 4. Update order status if applicable
}

async function handleChargeFailed(data: any) {
  // Handle failed payment
  console.log('Payment failed:', {
    reference: data.reference,
    amount: data.amount / 100,
    customer: data.customer.email,
    status: data.status,
    gateway_response: data.gateway_response,
  });
  
  // Here you would typically:
  // 1. Log the failure
  // 2. Notify the user
  // 3. Update order status
}

async function handleTransferSuccess(data: any) {
  // Handle successful transfer (for payouts)
  console.log('Transfer successful:', {
    reference: data.reference,
    amount: data.amount / 100,
    recipient: data.recipient,
    status: data.status,
  });
}

async function handleTransferFailed(data: any) {
  // Handle failed transfer
  console.log('Transfer failed:', {
    reference: data.reference,
    amount: data.amount / 100,
    recipient: data.recipient,
    status: data.status,
    failure_reason: data.failure_reason,
  });
}