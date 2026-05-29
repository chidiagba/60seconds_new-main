import { z } from 'zod';
import { publicProcedure } from '@/backend/trpc/create-context';
import { supabase } from '@/backend/lib/supabase';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_330eb515e3709b9f2b60dfd11c9c7396aba4fcf5';
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

export const verifyPaymentProcedure = publicProcedure
  .input(z.object({
    reference: z.string(),
  }))
  .query(async ({ input }) => {
    try {
      const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/verify/${input.reference}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to verify payment');
      }
      
      if (!data.status) {
        throw new Error(data.message || 'Payment verification failed');
      }
      
      const transaction = data.data;
      
      // If payment is successful, update database and generate order PDF
      if (transaction.status === 'success') {
        try {
          // Extract order information from metadata
          const metadata = transaction.metadata || {};
          const orderId = metadata.orderId;
          
          if (orderId) {
            // Update order status in Supabase
            const { error: orderUpdateError } = await supabase
              .from('orders')
              .update({
                payment_status: 'paid',
                payment_reference: transaction.reference,
                payment_transaction_id: transaction.id.toString(),
                payment_gateway_response: transaction,
                payment_metadata: metadata,
                updated_at: new Date().toISOString()
              })
              .eq('id', orderId);
            
            if (orderUpdateError) {
              console.error('Failed to update order status:', orderUpdateError);
            } else {
              console.log('Order status updated successfully for Paystack payment:', orderId);
            }
            
            // Create payment record in Supabase
            const { error: paymentInsertError } = await supabase
              .from('payments')
              .insert({
                order_id: orderId,
                user_id: metadata.userId,
                payment_provider: 'paystack',
                payment_method_id: transaction.authorization?.authorization_code || null,
                amount: transaction.amount / 100,
                currency: transaction.currency,
                status: 'completed',
                transaction_id: transaction.id.toString(),
                gateway_reference: transaction.reference,
                gateway_response: transaction,
                metadata: metadata,
                processing_fee: metadata.processingFee || 0,
                net_amount: (transaction.amount / 100) - (metadata.processingFee || 0),
                completed_at: new Date().toISOString()
              });
            
            if (paymentInsertError) {
              console.error('Failed to create payment record:', paymentInsertError);
            } else {
              console.log('Payment record created successfully');
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
                const newBalance = (currentWallet?.balance || 0) + (transaction.amount / 100);
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
                  console.log('Wallet balance updated successfully');
                }
              }
              
              // Create wallet transaction record
              const { error: transactionInsertError } = await supabase
                .from('transactions')
                .insert({
                  wallet_id: metadata.walletId,
                  amount: transaction.amount / 100,
                  type: 'deposit',
                  status: 'completed',
                  description: `Wallet funding via Paystack - ${transaction.reference}`,
                  metadata: {
                    paymentProvider: 'paystack',
                    paystackReference: transaction.reference,
                    paystackTransactionId: transaction.id.toString()
                  }
                });
              
              if (transactionInsertError) {
                console.error('Failed to create wallet transaction:', transactionInsertError);
              }
            }
          }
          
          console.log('Paystack payment processed successfully:', transaction.reference);
        } catch (dbError) {
          console.error('Database update failed for Paystack payment:', dbError);
          // Don't fail the payment verification if database update fails
        }
      }
      
      return {
        success: true,
        data: {
          id: transaction.id,
          reference: transaction.reference,
          amount: transaction.amount / 100, // Convert back to dollars
          currency: transaction.currency,
          status: transaction.status,
          gateway_response: transaction.gateway_response,
          paid_at: transaction.paid_at,
          created_at: transaction.created_at,
          channel: transaction.channel,
          customer: {
            id: transaction.customer.id,
            email: transaction.customer.email,
            customer_code: transaction.customer.customer_code,
          },
          authorization: transaction.authorization ? {
            authorization_code: transaction.authorization.authorization_code,
            bin: transaction.authorization.bin,
            last4: transaction.authorization.last4,
            exp_month: transaction.authorization.exp_month,
            exp_year: transaction.authorization.exp_year,
            channel: transaction.authorization.channel,
            card_type: transaction.authorization.card_type,
            bank: transaction.authorization.bank,
            country_code: transaction.authorization.country_code,
            brand: transaction.authorization.brand,
            reusable: transaction.authorization.reusable,
          } : null,
          metadata: transaction.metadata,
        },
      };
    } catch (error: any) {
      console.error('Paystack verification error:', error);
      throw new Error(error.message || 'Failed to verify payment');
    }
  });