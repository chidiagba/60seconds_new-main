import { logger } from '@/lib/logger';
import { Platform } from 'react-native';
import { trpcClient } from '@/lib/trpc';
import { DATATRANS_CONFIG } from '@/lib/datatrans-config';
import { supabase } from '@/lib/supabase';

export interface DatatransInitializeParams {
  amount: number;
  currency?: string;
  orderId: string;
  customerEmail: string;
  customerName?: string;
  description?: string;
  returnUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, any>;

  userId?: string;
  walletId?: string;
  paymentType?: 'order_payment' | 'wallet_funding';
}

export interface DatatransPaymentResponse {
  success: boolean;
  data: {
    transactionId: string;
    redirectUrl: string;
    orderId: string;
    amount: number;
    currency: string;
    status: string;
    expiresAt: string;
  };
}

export interface DatatransVerifyResponse {
  success: boolean;
  data: {
    transactionId: string;
    orderId: string;
    amount: number;
    currency: string;
    status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
    gatewayResponse?: string;
    paidAt?: string;
    createdAt: string;
    customer: {
      email: string;
      name?: string;
    };
    metadata?: any;
  };
}

export interface DatatransDirectCardPaymentParams {
  email: string;
  amount: number;
  currency: string;
  reference: string;
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  cvv: string;
  cardholderName: string;
  userId: string;
  paymentType: 'order_payment' | 'wallet_funding';
  metadata?: Record<string, any>;
}

export interface DatatransDirectCardPaymentResponse {
  success: boolean;
  data: {
    reference: string;
    status: 'success' | 'pending' | 'failed';
    authorization_url?: string;
    access_code?: string;
    message?: string;
    gateway_response?: string;
    transaction_id?: string;
    amount: number;
    currency: string;
    customer: {
      email: string;
      name?: string;
    };
    authorization?: {
      authorization_code: string;
      last4: string;
      exp_month: string;
      exp_year: string;
      brand: string;
      bank: string;
      country_code: string;
    };
  };
  message?: string;
}

class DatatransService {
  private static instance: DatatransService;
  
  public static getInstance(): DatatransService {
    if (!DatatransService.instance) {
      DatatransService.instance = new DatatransService();
    }
    return DatatransService.instance;
  }

  /**
   * Check if real Datatrans keys are configured
   */
  isRealDatatransKey(): boolean {
    const hasMerchantId = Boolean(
      DATATRANS_CONFIG.MERCHANT_ID && 
      DATATRANS_CONFIG.MERCHANT_ID !== 'your_merchant_id_here' &&
      DATATRANS_CONFIG.MERCHANT_ID !== ''
    );
    
    const hasPassword = Boolean(
      DATATRANS_CONFIG.PASSWORD && 
      DATATRANS_CONFIG.PASSWORD !== '' &&
      DATATRANS_CONFIG.PASSWORD.length > 10
    );

    return hasMerchantId && hasPassword;
  }

  /**
   * Initialize Datatrans payment
   */
  async initializePayment(params: DatatransInitializeParams): Promise<DatatransPaymentResponse> {
    throw new Error('Payment provider is disabled. Use Stripe or Paystack.');
    try {
      logger.debug('Initializing Datatrans payment:', {
        amount: params.amount,
        currency: params.currency,
        orderId: params.orderId,
        customerEmail: params.customerEmail
      });

      const result = await trpcClient.datatrans.initialize.mutate({
        amount: params.amount,
        currency: params.currency || DATATRANS_CONFIG.DEFAULT_CURRENCY,
        orderId: params.orderId,
        customerEmail: params.customerEmail,
        customerName: params.customerName,
        description: params.description,
        returnUrl: params.returnUrl,
        cancelUrl: params.cancelUrl,
        metadata: params.metadata,
        userId: params.userId,
        walletId: params.walletId,
        paymentType: params.paymentType || 'order_payment',
      });

      return result as DatatransPaymentResponse;
    } catch (error: any) {
      logger.error('Datatrans initialize payment error:', error);
      throw new Error(error.message || 'Failed to initialize Datatrans payment');
    }
  }

  /**
   * Verify Datatrans payment
   */
  async verifyPayment(transactionId: string): Promise<DatatransVerifyResponse> {
    throw new Error('Payment provider is disabled. Use Stripe or Paystack.');
    try {
      logger.debug('Verifying Datatrans payment:', transactionId);
      
      const result = await trpcClient.datatrans.verify.mutate({
        transactionId,
      });
      
      return result as DatatransVerifyResponse;
    } catch (error: any) {
      logger.error('Datatrans verify payment error:', error);
      throw new Error(error.message || 'Failed to verify Datatrans payment');
    }
  }

  /**
   * Process direct card payment with Datatrans
   * Uses Supabase Edge Functions instead of TRPC backend
   */
  async processDirectCardPayment(params: DatatransDirectCardPaymentParams): Promise<DatatransDirectCardPaymentResponse> {
    throw new Error('Payment provider is disabled. Use Stripe or Paystack.');
    try {
      logger.debug('Processing Datatrans direct card payment via Supabase Edge Function:', {
        email: params.email,
        amount: params.amount,
        currency: params.currency,
        reference: params.reference,
        cardNumber: params.cardNumber.replace(/\s/g, '').slice(0, 4) + '****',
        userId: params.userId
      });

      // Try Supabase Edge Function first, fallback to TRPC if it fails
      let useEdgeFunction = true;
      let edgeFunctionError: any = null;
      
      try {
        logger.debug('🔄 Attempting Supabase Edge Function...');
        const { data, error } = await supabase.functions.invoke('datatrans-payment', {
          body: {
            email: params.email,
            amount: params.amount,
            currency: params.currency || 'CHF',
            reference: params.reference,
            cardNumber: params.cardNumber,
            expiryMonth: params.expiryMonth,
            expiryYear: params.expiryYear,
            cvv: params.cvv,
            cardholderName: params.cardholderName,
            userId: params.userId,
            paymentType: params.paymentType || 'wallet_funding',
            metadata: params.metadata || {},
          },
        });

        if (error) {
          // Extract actual error from Supabase error object
          let actualError = error.message || 'Unknown error';
          let errorStatus = 0;
          
          // Log full error for debugging
          logger.error('❌ Supabase Edge Function error object:', JSON.stringify({
            message: error.message,
            name: error.name,
            context: error.context,
            stack: error.stack
          }, null, 2));
          
          // Try to get response body and status from error context
          if (error.context) {
            try {
              const context = error.context;
              
              // Get status code
              if (context.status) {
                errorStatus = context.status;
                logger.error(`❌ Edge Function returned status: ${errorStatus}`);
              }
              
              // Try to read response body if available
              if (context.body) {
                let body;
                if (typeof context.body === 'string') {
                  try {
                    body = JSON.parse(context.body);
                  } catch {
                    body = { message: context.body };
                  }
                } else {
                  body = context.body;
                }
                
                if (body.message) {
                  actualError = body.message;
                  logger.error('❌ Error message from function:', actualError);
                } else if (body.error) {
                  actualError = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
                } else {
                  actualError = JSON.stringify(body);
                }
              }
            } catch (e) {
              logger.error('Failed to parse error context:', e);
            }
          }
          
          // Check if function is not deployed (404) - only treat 404 as "not deployed"
          const errorMsg = (error.message || '').toLowerCase();
          const is404 = errorStatus === 404 || 
                       errorMsg.includes('404') || 
              errorMsg.includes('not found') || 
              errorMsg.includes('function not found') ||
                       errorMsg.includes('requested function was not found');
          
          if (is404) {
            logger.warn('⚠️ Edge Function not deployed (404), falling back to TRPC backend');
            logger.warn('⚠️ Error:', actualError);
            useEdgeFunction = false;
            edgeFunctionError = new Error(`Edge Function not deployed: ${actualError}. Using TRPC backend instead.`);
          } else {
            // 500 or other errors - these mean function is deployed but has an error
            logger.error('❌ Edge Function returned error (status ' + errorStatus + '):', actualError);
            logger.error('💡 This usually means:');
            logger.error('   1. Missing secrets (DATATRANS_MERCHANT_ID, DATATRANS_PASSWORD)');
            logger.error('   2. Invalid Datatrans credentials');
            logger.error('   3. Check Supabase Dashboard → Edge Functions → datatrans-payment → Logs');
            throw new Error(actualError);
          }
        } else if (data) {
          logger.debug('✅ Edge Function response received');
          return data as DatatransDirectCardPaymentResponse;
        } else {
          throw new Error('No response data from Edge Function');
        }
      } catch (edgeError: any) {
        // Log the actual error for debugging
        logger.error('❌ Edge Function call failed:', edgeError);
        logger.error('❌ Error message:', edgeError?.message);
        logger.error('❌ Error name:', edgeError?.name);
        
        // Check if it's a "not found" or "non-2xx" error - fallback to TRPC
        const errorMsg = (edgeError?.message || '').toLowerCase();
        const errorName = (edgeError?.name || '').toLowerCase();
        
        if (errorMsg.includes('404') || 
            errorMsg.includes('not found') || 
            errorMsg.includes('function not found') ||
            errorMsg.includes('non-2xx status code') ||
            errorMsg.includes('requested function was not found') ||
            errorName.includes('functionshttperror')) {
          logger.warn('⚠️ Edge Function not deployed or unavailable, falling back to TRPC backend');
          logger.warn('⚠️ Original error:', edgeError?.message || 'Unknown error');
          useEdgeFunction = false;
          edgeFunctionError = edgeError;
        } else {
          // Real error from Edge Function - rethrow
          logger.error('❌ Edge Function returned unexpected error, rethrowing...');
          throw edgeError;
        }
      }

      // Fallback to TRPC backend if Edge Function is not available
      if (!useEdgeFunction) {
        logger.debug('🔄 Using TRPC backend as fallback...');
        try {
          const result = await trpcClient.datatrans.directCardPayment.mutate({
            email: params.email,
            amount: params.amount,
            currency: params.currency,
            reference: params.reference,
            cardNumber: params.cardNumber,
            expiryMonth: params.expiryMonth,
            expiryYear: params.expiryYear,
            cvv: params.cvv,
            cardholderName: params.cardholderName,
            userId: params.userId,
            paymentType: params.paymentType,
            metadata: params.metadata,
          });
          
          // Fix [object Object] in message field if present
          if (result && typeof result === 'object' && 'message' in result) {
            if (result.message === '[object Object]' || (typeof result.message === 'object' && result.message !== null)) {
              logger.warn('⚠️ TRPC returned [object Object] in message, extracting real error...');
              // Try to get real error from data
              if (result.data && typeof result.data === 'object' && 'gateway_response' in result.data) {
                const gateway = (result.data as any).gateway_response;
                if (typeof gateway === 'object') {
                  const gatewayStr = JSON.stringify(gateway);
                  result.message = gatewayStr.length > 200 ? gatewayStr.substring(0, 200) + '...' : gatewayStr;
                }
              } else if (result.data) {
                result.message = 'Payment failed. Check backend logs for details.';
              } else {
                result.message = 'Payment processing failed';
              }
            }
          }
          
          return result as DatatransDirectCardPaymentResponse;
        } catch (trpcError: any) {
          // TRPC error - extract message properly
          logger.error('❌ TRPC backend error:', trpcError);
          throw trpcError; // Let the outer catch handle it
        }
      }

      // This should never happen, but TypeScript needs it
      throw new Error('Unexpected state: Edge Function failed but fallback not triggered');

    } catch (error: any) {
      logger.error('❌ Datatrans direct card payment error:', error);
      logger.error('❌ Error type:', error?.constructor?.name);
      logger.error('❌ Error message:', error?.message);
      logger.error('❌ Error data:', error?.data);
      logger.error('❌ Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
      
      // Provide helpful error message - properly extract string from error
      let errorMessage = 'Payment processing failed';
      
      // Extract error message from various possible locations - ensure it's always a string
      if (typeof error?.message === 'string' && error.message !== '[object Object]') {
        errorMessage = error.message;
      } else if (error?.data?.message) {
        if (typeof error.data.message === 'string' && error.data.message !== '[object Object]') {
          errorMessage = error.data.message;
        } else if (error.data.message && typeof error.data.message === 'object') {
          errorMessage = JSON.stringify(error.data.message, null, 2);
        } else {
          errorMessage = String(error.data.message);
        }
      } else if (error?.data?.error) {
        if (typeof error.data.error === 'string' && error.data.error !== '[object Object]') {
          errorMessage = error.data.error;
        } else if (error.data.error && typeof error.data.error === 'object') {
          errorMessage = JSON.stringify(error.data.error, null, 2);
        } else {
          errorMessage = String(error.data.error);
        }
      } else if (error?.message && typeof error.message === 'object') {
        errorMessage = JSON.stringify(error.message, null, 2);
      } else if (error?.data) {
        errorMessage = JSON.stringify(error.data, null, 2);
      } else if (error?.message) {
        // Last resort - convert to string safely
        try {
          errorMessage = String(error.message);
          if (errorMessage === '[object Object]') {
            errorMessage = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
          }
        } catch {
          errorMessage = 'Payment processing failed - unknown error';
        }
      }
      
      // Check for Supabase Edge Function errors
      if (error?.message?.includes('Function not found') || error?.message?.includes('404')) {
        errorMessage = 'Payment function not deployed. Please deploy the Supabase Edge Function: supabase functions deploy datatrans-payment';
        logger.error('❌ Edge Function not found!');
        logger.error('💡 Deploy the function: supabase functions deploy datatrans-payment');
      }
      
      // Ensure errorMessage is always a string and not "[object Object]"
      if (errorMessage === '[object Object]' || (typeof errorMessage === 'object' && errorMessage !== null)) {
        errorMessage = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
      }
      
      return {
        success: false,
        data: {
          reference: params.reference,
          status: 'failed' as const,
          amount: params.amount,
          currency: params.currency,
          customer: {
            email: params.email,
            name: params.cardholderName
          }
        },
        message: String(errorMessage) // Force to string
      };
    }
  }

  /**
   * Detect card brand from card number
   */
  private detectCardBrand(cardNumber: string): string {
    const number = cardNumber.replace(/\s/g, '');
    const firstDigit = number[0];
    const firstTwoDigits = number.slice(0, 2);
    const firstFourDigits = number.slice(0, 4);

    if (firstDigit === '4') return 'visa';
    if (firstTwoDigits >= '51' && firstTwoDigits <= '55') return 'mastercard';
    if (firstTwoDigits === '34' || firstTwoDigits === '37') return 'amex';
    if (firstFourDigits === '6011' || firstTwoDigits === '65') return 'discover';
    if (firstTwoDigits >= '30' && firstTwoDigits <= '35') return 'diners';
    if (firstFourDigits === '3528' || firstFourDigits === '3529') return 'jcb';
    
    return 'unknown';
  }

  /**
   * Generate a unique reference
   */
  generateReference(prefix: string = 'datatrans'): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `${prefix}_${timestamp}_${random}`;
  }

  /**
   * Generate a unique payment ID
   */
  generatePaymentId(prefix: string = '60seconds'): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `${prefix}_${timestamp}_${random}`;
  }

  /**
   * Save payment method to Supabase after successful payment
   */
  async savePaymentMethodToSupabase(params: {
    userId: string;
    nickname: string;
    cardType: string;
    isDefault: boolean;
    datatransReference: string;
    authorization: {
      authorization_code: string;
      last4: string;
      exp_month: string;
      exp_year: string;
      brand: string;
      bank: string;
      country_code: string;
    };
  }) {
    throw new Error('Payment provider is disabled. Use Stripe or Paystack.');
    try {
      logger.debug('💾 Saving Datatrans payment method to Supabase...');
      
      // Use the imported supabase client
      
      // Get authenticated user
      const { data: { user: authUser } } = await supabase.auth.getUser();
      
      if (!authUser) {
        logger.debug('⚠️ Skipping Supabase save: no authenticated user');
        return null;
      }

      // Use authenticated user ID instead of passed userId
      const userId = authUser?.id;

      // Determine card type based on brand
      const cardType = params.cardType || params.authorization.brand || 'credit_card';

      const { data, error } = await supabase
        .from('payment_methods')
        .insert({
          user_id: userId,
          type: cardType,
          provider: 'datatrans',
          nickname: params.nickname,
          is_default: params.isDefault,
          last_four: params.authorization.last4,
          expiry_month: params.authorization.exp_month,
          expiry_year: params.authorization.exp_year,
          brand: params.authorization.brand,
          provider_reference: params.datatransReference,
          metadata: {
            authorization_code: params.authorization.authorization_code,
            bank: params.authorization.bank,
            country_code: params.authorization.country_code,
            provider: 'datatrans',
            saved_at: new Date().toISOString(),
          },
        })
        .select()
        .single();

      if (error) {
        logger.error('❌ Supabase save error:', error);
        throw error;
      }

      logger.debug('✅ Datatrans payment method saved to Supabase:', data);
      return data;
    } catch (error: any) {
      logger.error('❌ Error saving Datatrans payment method to Supabase:', error);
      throw error;
    }
  }

  /**
   * Format amount for display
   */
  formatAmount(amount: number, currency: string = 'CHF'): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(amount);
  }
}

// Export singleton instance
const datatransService = DatatransService.getInstance();
export default datatransService;

