import { z } from 'zod';
import { publicProcedure } from '../../../create-context';
import { supabase } from '@/backend/lib/supabase';
import crypto from 'crypto';

// Datatrans API Configuration
const DATATRANS_MERCHANT_ID = process.env.DATATRANS_MERCHANT_ID || '1110020919';
const DATATRANS_PASSWORD = process.env.DATATRANS_PASSWORD || '';
const DATATRANS_BASE_URL = process.env.DATATRANS_BASE_URL || 'https://api.datatrans.com';

// Helper function to ensure message is always a string
const ensureStringMessage = (msg: any): string => {
  if (typeof msg === 'string' && msg !== '[object Object]') {
    return msg;
  }
  if (msg === null || msg === undefined) {
    return 'Unknown error';
  }
  if (typeof msg === 'object') {
    try {
      const str = JSON.stringify(msg);
      return str === '[object Object]' ? 'Invalid error format' : str;
    } catch {
      return 'Error serialization failed';
    }
  }
  const str = String(msg);
  return str === '[object Object]' ? 'Invalid error format' : str;
};

export const directCardPaymentProcedure = publicProcedure
  .input(z.object({
    email: z.string().email(),
    amount: z.number().positive(),
    currency: z.string().default('CHF'),
    reference: z.string(),
    cardNumber: z.string().min(13).max(19),
    expiryMonth: z.string().min(1).max(2),
    expiryYear: z.string().min(2).max(4),
    cvv: z.string().min(3).max(4),
    cardholderName: z.string().min(2),
    userId: z.string(),
    paymentType: z.enum(['order_payment', 'wallet_funding']).default('order_payment'),
    metadata: z.record(z.any()).optional(),
  }))
  .mutation(async ({ input }) => {
    try {
      console.log('Processing Datatrans direct card payment:', {
        email: input.email,
        amount: input.amount,
        currency: input.currency,
        reference: input.reference,
        userId: input.userId,
        paymentType: input.paymentType
      });

      // Verify Datatrans keys are configured
      const isRealDatatransKey = Boolean(
        DATATRANS_MERCHANT_ID && 
        DATATRANS_PASSWORD && 
        DATATRANS_MERCHANT_ID !== 'your_merchant_id_here' && 
        DATATRANS_PASSWORD !== '' &&
        DATATRANS_PASSWORD.length > 5
      );
      
      console.log('🔑 Datatrans Configuration:', {
        merchantId: DATATRANS_MERCHANT_ID,
        passwordLength: DATATRANS_PASSWORD?.length || 0,
        baseUrl: DATATRANS_BASE_URL,
        isRealKey: isRealDatatransKey
      });
      
      if (!isRealDatatransKey) {
        const errorMsg = 'Datatrans API credentials are not configured. Please set DATATRANS_MERCHANT_ID and DATATRANS_PASSWORD environment variables.';
        console.error('❌', errorMsg);
        throw new Error(errorMsg);
      }

      // Process Datatrans payment
      console.log('💳 Processing Datatrans Payment:', {
        reference: input.reference,
        amount: input.amount,
        currency: input.currency,
        email: input.email
      });

      // Datatrans API payload format (based on common Datatrans API structure)
      // Convert amount to cents (smallest currency unit)
      const amountInCents = Math.round(input.amount * 100);
      
      const payload = {
        amount: amountInCents,
        currency: input.currency,
        refno: input.reference,
        aliasCC: input.cardNumber.replace(/\s/g, ''),
        expm: input.expiryMonth,
        expy: input.expiryYear,
        cvv: input.cvv,
        cardholder: input.cardholderName,
        email: input.email,
        language: 'en',
        successUrl: `${process.env.EXPO_PUBLIC_RORK_API_BASE_URL || 'http://localhost:3001'}/datatrans/success`,
        errorUrl: `${process.env.EXPO_PUBLIC_RORK_API_BASE_URL || 'http://localhost:3001'}/datatrans/error`,
        cancelUrl: `${process.env.EXPO_PUBLIC_RORK_API_BASE_URL || 'http://localhost:3001'}/datatrans/cancel`,
        metadata: {
          ...input.metadata,
          user_id: input.userId,
          payment_type: input.paymentType,
          source: 'mobile_app',
          app_name: '60Seconds',
          timestamp: new Date().toISOString()
        }
      };

      console.log('📤 Calling Datatrans API...');
      const apiPath = '/v1/transactions';
      const apiUrl = `${DATATRANS_BASE_URL}${apiPath}`;
      console.log(`   URL: ${apiUrl}`);
      console.log(`   Method: POST`);
      
      // Datatrans uses Basic Authentication with Merchant ID and Password
      const authString = Buffer.from(`${DATATRANS_MERCHANT_ID}:${DATATRANS_PASSWORD}`).toString('base64');
      
      console.log(`   Auth: Basic Auth with Merchant ID: ${DATATRANS_MERCHANT_ID}`);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      console.log(`📥 Datatrans API Response Status: ${response.status} ${response.statusText}`);

      // Check if response is JSON
      const responseContentType = response.headers.get('content-type');
      let data;
      
      if (responseContentType && responseContentType.includes('application/json')) {
        data = await response.json();
      } else {
        const textResponse = await response.text();
        console.error('Non-JSON response from Datatrans:', textResponse);
        throw new Error(`Datatrans API returned non-JSON response: ${textResponse}`);
      }

      if (!response.ok) {
        console.error('❌ Datatrans API Error Response Status:', response.status, response.statusText);
        console.error('❌ Datatrans API Error Response Body:', JSON.stringify(data, null, 2));
        
        // Extract error message properly - handle objects and ensure it's always a string
        let errorMsg = `Datatrans payment failed with status ${response.status}`;
        
        // Try to extract meaningful error message
        if (data?.error) {
          if (typeof data.error === 'string') {
            errorMsg = data.error;
          } else if (data.error?.message) {
            errorMsg = String(data.error.message);
          } else if (data.error?.code) {
            errorMsg = `Error ${data.error.code}: ${data.error.message || 'Payment failed'}`;
          } else {
            errorMsg = JSON.stringify(data.error);
          }
        } else if (data?.message) {
          if (typeof data.message === 'string') {
            errorMsg = data.message;
          } else {
            errorMsg = JSON.stringify(data.message);
          }
        } else if (data?.errors && Array.isArray(data.errors)) {
          errorMsg = data.errors.map((e: any) => e.message || String(e)).join(', ');
        } else if (data) {
          errorMsg = JSON.stringify(data);
        }
        
        // Ensure it's a string and not "[object Object]"
        if (errorMsg === '[object Object]' || typeof errorMsg !== 'string') {
          errorMsg = `Datatrans API error (${response.status}): ${response.statusText || 'Unknown error'}`;
        }
        
        console.error('📝 Throwing error with message:', errorMsg);
        throw new Error(errorMsg);
      }

      console.log('✅ Datatrans API Success!');
      console.log(`   Transaction ID: ${data.transactionId || data.transaction_id || data.refno || 'N/A'}`);
      console.log(`   Status: ${data.status || 'N/A'}`);
      console.log(`   Reference: ${data.refno || data.reference || input.reference}`);
      console.log('');
      console.log('📊 Payment processed successfully');
      console.log(`   Search by reference: ${data.refno || data.reference || input.reference}`);
      console.log('');

      // Determine transaction ID and status
      const transactionId = data.transactionId || data.transaction_id || data.refno || input.reference;
      const status = data.status === 'authorized' || data.status === 'success' ? 'success' : 
                     data.status === 'pending' ? 'pending' : 'failed';

      const result = {
        success: status === 'success' || status === 'pending',
        data: {
          reference: data.refno || data.reference || input.reference,
          status: status,
          authorization_url: data.redirectUrl || data.authorization_url,
          access_code: data.accessCode || data.access_code,
          message: ensureStringMessage(data.message) || 'Payment processed successfully',
          gateway_response: data,
          transaction_id: transactionId,
          amount: input.amount,
          currency: input.currency,
          customer: {
            email: input.email,
            name: input.cardholderName
          },
          authorization: data.authorization ? {
            authorization_code: data.authorization.code || transactionId,
            last4: input.cardNumber.replace(/\s/g, '').slice(-4),
            exp_month: input.expiryMonth,
            exp_year: input.expiryYear,
            brand: detectCardBrand(input.cardNumber),
            bank: data.authorization.bank || 'N/A',
            country_code: data.authorization.country || 'CH'
          } : {
            authorization_code: transactionId,
            last4: input.cardNumber.replace(/\s/g, '').slice(-4),
            exp_month: input.expiryMonth,
            exp_year: input.expiryYear,
            brand: detectCardBrand(input.cardNumber),
            bank: 'N/A',
            country_code: 'CH'
          }
        },
        message: ensureStringMessage(data.message) || 'Payment processed successfully'
      };

      // Save real payment to database
      console.log('💾 Saving payment to database...');
      await savePaymentToDatabase({
        ...input,
        response: result.data,
        isMock: false
      });
      console.log('✅ Payment saved to database!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');

      return result;

    } catch (error: any) {
      console.error('❌ Datatrans direct card payment error:', error);
      
      // Log error details safely
      try {
        const errorDetails = {
          message: error?.message,
          messageType: typeof error?.message,
          name: error?.name,
          hasData: !!error?.data,
          hasResponse: !!error?.response,
          responseStatus: error?.response?.status,
          responseData: error?.response?.data
        };
        console.error('Error details:', JSON.stringify(errorDetails, null, 2));
      } catch (logError) {
        console.error('Failed to log error details:', logError);
      }
      
      // Save failed payment to database
      try {
        await saveFailedPaymentToDatabase({
          ...input,
          error: typeof error.message === 'string' ? error.message : JSON.stringify(error.message)
        });
      } catch (dbError) {
        console.error('Failed to save payment error to database:', dbError);
      }

      // REPLACE START - Proper error message extraction - ensure always a string
      let errorMessage = 'Payment processing failed';
      
      // Extract error message - use helper function to ensure it's always a string
      if (error?.message) {
        errorMessage = ensureStringMessage(error.message);
      }
      
      // If we still have default, try other sources
      if (errorMessage === 'Payment processing failed') {
        if (error?.response?.data) {
          // Handle HTTP response errors
          if (error.response.data?.error) {
            errorMessage = ensureStringMessage(error.response.data.error);
          } else if (error.response.data?.message) {
            errorMessage = ensureStringMessage(error.response.data.message);
          } else if (typeof error.response.data === 'string') {
            errorMessage = error.response.data;
          } else {
            errorMessage = ensureStringMessage(error.response.data);
          }
        } else if (error?.data?.message) {
          errorMessage = ensureStringMessage(error.data.message);
        } else if (error?.data?.error) {
          errorMessage = ensureStringMessage(error.data.error);
        } else if (error?.data) {
          errorMessage = ensureStringMessage(error.data);
        }
      }
      
      // Add HTTP status if available
      if (error?.response?.status) {
        errorMessage = `[HTTP ${error.response.status}] ${errorMessage}`;
      }
      
      // Final safety check using helper
      errorMessage = ensureStringMessage(errorMessage);
      
      console.error('📝 Final extracted error message:', errorMessage);
      // REPLACE END
      
      // Use the helper function one more time to be absolutely sure
      const safeMessage = ensureStringMessage(errorMessage);
      
      console.error('✅ Returning error response with message:', safeMessage);
      
      return {
        success: false,
        data: {
          reference: input.reference,
          status: 'failed',
          amount: input.amount,
          currency: input.currency,
          customer: {
            email: input.email,
            name: input.cardholderName
          }
        },
        message: safeMessage // Guaranteed to be a string
      };
    }
  });

/**
 * Detect card brand from card number
 */
function detectCardBrand(cardNumber: string): string {
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
 * Save successful payment to database
 */
async function savePaymentToDatabase(params: {
  email: string;
  amount: number;
  currency: string;
  reference: string;
  userId: string;
  paymentType: string;
  response: any;
  isMock: boolean;
}) {
  try {
    console.log('💾 Saving Datatrans payment to database...');
    
    // Create payment record
    const { error: paymentError } = await supabase
      .from('payments')
      .insert({
        user_id: params.userId,
        payment_provider: 'datatrans',
        amount: params.amount,
        currency: params.currency,
        status: params.response.status === 'success' ? 'completed' : 'pending',
        transaction_id: params.response.transaction_id || params.reference,
        gateway_reference: params.reference,
        gateway_response: params.response,
        metadata: {
          payment_type: params.paymentType,
          customer_email: params.email,
          is_mock: params.isMock,
          source: 'direct_card_payment'
        },
        completed_at: params.response.status === 'success' ? new Date().toISOString() : null
      });

    if (paymentError) {
      console.error('❌ Error saving payment:', paymentError);
      // Don't throw - payment was successful, just DB save failed
    }

    // If payment is successful and has authorization data, save payment method
    if (params.response.status === 'success' && params.response.authorization) {
      const { error: paymentMethodError } = await supabase
        .from('payment_methods')
        .insert({
          user_id: params.userId,
          type: 'datatrans_card',
          nickname: `${params.response.authorization.brand.toUpperCase()} ****${params.response.authorization.last4}`,
          is_default: false,
          provider: 'datatrans',
          provider_reference: params.reference,
          card_type: 'credit_card',
          last_four: params.response.authorization.last4,
          expiry_month: params.response.authorization.exp_month,
          expiry_year: params.response.authorization.exp_year,
          card_brand: params.response.authorization.brand,
          bank_name: params.response.authorization.bank,
          country_code: params.response.authorization.country_code,
          authorization_code: params.response.authorization.authorization_code,
          metadata: {
            provider: 'datatrans',
            card_type: 'credit_card',
            created_via: 'direct_card_payment',
            description: 'Datatrans payment method setup'
          }
        });

      if (paymentMethodError) {
        console.error('❌ Error saving payment method:', paymentMethodError);
        // Don't throw here, payment was successful
      }
    }

    console.log('✅ Datatrans payment saved to database successfully');
  } catch (error: any) {
    console.error('❌ Error saving Datatrans payment to database:', error);
    // Don't throw here, payment processing should continue
  }
}

/**
 * Save failed payment to database
 */
async function saveFailedPaymentToDatabase(params: {
  email: string;
  amount: number;
  currency: string;
  reference: string;
  userId: string;
  paymentType: string;
  error: string;
}) {
  try {
    console.log('💾 Saving failed Datatrans payment to database...');
    
    const { error } = await supabase
      .from('payments')
      .insert({
        user_id: params.userId,
        payment_provider: 'datatrans',
        amount: params.amount,
        currency: params.currency,
        status: 'failed',
        transaction_id: params.reference,
        gateway_reference: params.reference,
        gateway_response: { error: params.error },
        metadata: {
          payment_type: params.paymentType,
          customer_email: params.email,
          source: 'direct_card_payment',
          failure_reason: params.error
        },
        failed_at: new Date().toISOString()
      });

    if (error) {
      console.error('❌ Error saving failed payment:', error);
    } else {
      console.log('✅ Failed Datatrans payment saved to database');
    }
  } catch (error: any) {
    console.error('❌ Error saving failed Datatrans payment to database:', error);
  }
}

