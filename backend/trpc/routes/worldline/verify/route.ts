import { logger } from '../../../../lib/logger';
import { z } from 'zod';
import { disabledProcedure } from '../../../create-context';
import { supabase } from '@/backend/lib/supabase';

// Worldline API Configuration - PSPID is the Merchant ID
const WORLDLINE_MERCHANT_ID = process.env.WORLDLINE_MERCHANT_ID || '60secondsTechnologies';
const WORLDLINE_API_KEY = process.env.WORLDLINE_API_KEY || '';
const WORLDLINE_BASE_URL = process.env.WORLDLINE_BASE_URL || 'https://payment.direct.worldline-solutions.com/v2';

export const verifyPaymentProcedure = disabledProcedure
  .input(z.object({
    paymentId: z.string(),
  }))
  .query(async ({ input }) => {
    try {
      const response = await fetch(`${WORLDLINE_BASE_URL}/payments/${input.paymentId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${WORLDLINE_API_KEY}`,
          'Content-Type': 'application/json',
          'X-Merchant-Id': WORLDLINE_MERCHANT_ID,
        },
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to verify Worldline payment');
      }
      
      if (!data.success) {
        throw new Error(data.message || 'Worldline payment verification failed');
      }
      
      const payment = data.payment;
      
      // If payment is successful, update database and generate order PDF
      if (payment.status === 'SUCCESS') {
        try {
          // Extract order information from metadata
          const metadata = payment.metadata || {};
          const orderId = metadata.orderId;
          
          if (orderId) {
            // Update order status in Supabase
            const { error: orderUpdateError } = await supabase
              .from('orders')
              .update({
                payment_status: 'paid',
                payment_reference: payment.transactionId || payment.paymentId,
                payment_transaction_id: payment.paymentId,
                payment_gateway_response: payment,
                payment_metadata: metadata,
                updated_at: new Date().toISOString()
              })
              .eq('id', orderId);
            
            if (orderUpdateError) {
              console.error('Failed to update order status:', orderUpdateError);
            } else {
              logger.debug('Order status updated successfully for Worldline payment:', orderId);
            }
            
            // Create payment record in Supabase
            const { error: paymentInsertError } = await supabase
              .from('payments')
              .insert({
                order_id: orderId,
                user_id: metadata.userId,
                payment_provider: 'worldline',
                payment_method_id: metadata.paymentMethodId || null,
                amount: payment.amount / 100,
                currency: payment.currency,
                status: 'completed',
                transaction_id: payment.paymentId,
                gateway_reference: payment.transactionId || payment.paymentId,
                gateway_response: payment,
                metadata: metadata,
                processing_fee: metadata.processingFee || 0,
                net_amount: (payment.amount / 100) - (metadata.processingFee || 0),
                completed_at: new Date().toISOString()
              });
            
            if (paymentInsertError) {
              console.error('Failed to create payment record:', paymentInsertError);
            } else {
              logger.debug('Payment record created successfully');
            }
            
            // Update wallet balance if this is a wallet funding
            if (metadata.type === 'wallet_funding' && metadata.userId) {
              // Get current wallet balance first
              const { data: currentWallet, error: walletFetchError } = await supabase
                .from('wallets')
                .select('balance')
                .eq('user_id', metadata.userId)
                .single();
              
              if (walletFetchError) {
                console.error('Failed to fetch wallet balance:', walletFetchError);
              } else {
                const newBalance = (currentWallet?.balance || 0) + (payment.amount / 100);
                const { error: walletUpdateError } = await supabase
                  .from('wallets')
                  .update({
                    balance: newBalance,
                    updated_at: new Date().toISOString()
                  })
                  .eq('user_id', metadata.userId);
                
                if (walletUpdateError) {
                  console.error('Failed to update wallet balance:', walletUpdateError);
                } else {
                  logger.debug('Wallet balance updated successfully');
                }
              }
              
              // Create wallet transaction record
              const { error: transactionInsertError } = await supabase
                .from('transactions')
                .insert({
                  wallet_id: metadata.walletId,
                  amount: payment.amount / 100,
                  type: 'deposit',
                  status: 'completed',
                  description: `Wallet funding via Worldline - ${payment.paymentId}`,
                  metadata: {
                    paymentProvider: 'worldline',
                    worldlinePaymentId: payment.paymentId,
                    worldlineTransactionId: payment.transactionId
                  }
                });
              
              if (transactionInsertError) {
                console.error('Failed to create wallet transaction:', transactionInsertError);
              }
            }
          }
          
          logger.debug('Worldline payment processed successfully:', payment.paymentId);
        } catch (dbError) {
          console.error('Database update failed for Worldline payment:', dbError);
          // Don't fail the payment verification if database update fails
        }
      }
      
      return {
        success: true,
        data: {
          paymentId: payment.paymentId,
          orderId: payment.orderId,
          amount: payment.amount / 100, // Convert back to dollars
          currency: payment.currency,
          status: payment.status,
          transactionId: payment.transactionId,
          gatewayResponse: payment.gatewayResponse,
          paidAt: payment.paidAt,
          createdAt: payment.createdAt,
          customer: {
            email: payment.customer.email,
            name: payment.customer.name,
          },
          metadata: payment.metadata,
        },
      };
    } catch (error: any) {
      console.error('Worldline verification error:', error);
      
      // For development/testing, return mock data
      if (process.env.NODE_ENV === 'development') {
        logger.debug('Returning mock Worldline verification data for development');
        return {
          success: true,
          data: {
            paymentId: input.paymentId,
            orderId: `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
            amount: 25.00, // Mock amount
            currency: 'USD',
            status: 'SUCCESS',
            transactionId: `txn_${Date.now()}`,
            gatewayResponse: 'Payment successful',
            paidAt: new Date().toISOString(),
            createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
            customer: {
              email: 'test@example.com',
              name: 'Test Customer',
            },
            metadata: {
              app_name: '60Seconds',
              timestamp: new Date().toISOString(),
            },
          },
        };
      }
      
      throw new Error(error.message || 'Failed to verify Worldline payment');
    }
  });



