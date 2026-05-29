import { z } from 'zod';
import { publicProcedure } from '../../../create-context';

export const webhookProcedure = publicProcedure
  .input(z.object({
    paymentId: z.string(),
    status: z.enum(['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED']),
    transactionId: z.string().optional(),
    amount: z.number(),
    currency: z.string(),
    orderId: z.string(),
    customerEmail: z.string().email(),
    metadata: z.record(z.any()).optional(),
    timestamp: z.string(),
    signature: z.string().optional(),
  }))
  .mutation(async ({ input }) => {
    try {
      console.log('Received Worldline webhook:', input);
      
      // Verify webhook signature (implement based on Worldline's signature verification)
      // const isValidSignature = verifyWebhookSignature(input);
      // if (!isValidSignature) {
      //   throw new Error('Invalid webhook signature');
      // }
      
      // Update order status in database based on payment status
      const orderUpdates = {
        payment_status: input.status === 'SUCCESS' ? 'paid' : 
                      input.status === 'FAILED' ? 'failed' : 
                      input.status === 'CANCELLED' ? 'failed' : 'pending',
        payment_reference: input.transactionId || input.paymentId,
        updated_at: new Date().toISOString(),
      };
      
      // In a real implementation, you would update the order in your database here
      // await orderService.updateOrderStatus(input.orderId, orderUpdates);
      
      console.log('Order status updated for Worldline payment:', input.orderId, orderUpdates);
      
      // If payment is successful, trigger additional actions
      if (input.status === 'SUCCESS') {
        try {
          // Generate order PDF
          const orderNumber = input.orderId;
          const orderPDFData = {
            orderNumber,
            customerName: input.customerEmail.split('@')[0] || 'Customer',
            customerEmail: input.customerEmail,
            businessName: input.metadata?.businessName || 'Business',
            items: input.metadata?.cartItems || [],
            subtotal: (input.amount / 100) - (input.metadata?.platformFee || 0),
            tax: 0,
            discount: input.metadata?.discountAmount || 0,
            total: input.amount / 100,
            currency: input.currency,
            orderDate: input.timestamp,
            notes: input.metadata?.notes
          };
          
          console.log('Generating PDF for successful Worldline payment via webhook:', orderNumber, orderPDFData);
          // await generateOrderPDF(orderPDFData);
          
          // Send confirmation email
          // await emailService.sendOrderConfirmation(input.customerEmail, orderPDFData);
          
        } catch (error) {
          console.error('Error processing successful Worldline payment:', error);
          // Don't fail the webhook if additional processing fails
        }
      }
      
      return {
        success: true,
        message: 'Webhook processed successfully',
        orderId: input.orderId,
        paymentId: input.paymentId,
        status: input.status,
      };
    } catch (error: any) {
      console.error('Worldline webhook processing error:', error);
      throw new Error(error.message || 'Failed to process Worldline webhook');
    }
  });














