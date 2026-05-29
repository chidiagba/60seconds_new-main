import { z } from 'zod';
import { publicProcedure } from '../../../create-context';
import { supabase } from '@/backend/lib/supabase';
import crypto from 'crypto';

// Worldline API Configuration
// PSPID is the Merchant ID (Payment Service Provider ID)
const WORLDLINE_MERCHANT_ID = process.env.WORLDLINE_MERCHANT_ID || '60secondsTechnologies';
// Secret API Key (this is what you copied from dashboard)
const WORLDLINE_API_KEY = process.env.WORLDLINE_API_KEY || '43A1D436F54844DB73BF153ECBA9551A27636D945271483D0D0B62D713CDAB5C8B15F5158D9339FCA9EA4BD0C92678F94FC930FF3A3355BB1DC1856530B3D730';
// API Key ID (for reference, might be needed for some endpoints)
const WORLDLINE_API_KEY_ID = process.env.WORLDLINE_API_KEY_ID || '8F142108CB95DFDA64F6';
const WORLDLINE_BASE_URL = process.env.WORLDLINE_BASE_URL || 'https://payment.direct.worldline-solutions.com/v2';

export const directCardPaymentProcedure = publicProcedure
  .input(z.object({
    email: z.string().email(),
    amount: z.number().positive(),
    currency: z.string().default('USD'),
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
      console.log('Processing Worldline direct card payment:', {
        email: input.email,
        amount: input.amount,
        currency: input.currency,
        reference: input.reference,
        userId: input.userId,
        paymentType: input.paymentType
      });

      // Verify Worldline keys are configured - NO MOCK MODE
      const isRealWorldlineKey = Boolean(
        WORLDLINE_MERCHANT_ID && 
        WORLDLINE_API_KEY && 
        WORLDLINE_MERCHANT_ID !== 'your_merchant_id_here' && 
        WORLDLINE_API_KEY !== 'your_api_key_here' &&
        WORLDLINE_API_KEY.length > 20
      );
      
      console.log('🔑 Worldline Configuration:', {
        merchantId: WORLDLINE_MERCHANT_ID,
        apiKeyLength: WORLDLINE_API_KEY?.length,
        baseUrl: WORLDLINE_BASE_URL,
        isRealKey: isRealWorldlineKey
      });
      
      if (!isRealWorldlineKey) {
        const errorMsg = 'Worldline API keys are not configured. Please set WORLDLINE_MERCHANT_ID and WORLDLINE_API_KEY environment variables.';
        console.error('❌', errorMsg);
        throw new Error(errorMsg);
      }

      // Process Worldline payment
      console.log('💳 Processing Worldline Payment:', {
        reference: input.reference,
        amount: input.amount,
        currency: input.currency,
        email: input.email
      });

      // Worldline API payload format
      const payload = {
        amount: Math.round(input.amount * 100), // Convert to cents
        currency: input.currency,
        reference: input.reference,
        customer: {
          email: input.email,
          name: input.cardholderName
        },
        payment_method: {
          type: 'card',
          card: {
            number: input.cardNumber.replace(/\s/g, ''),
            expiry_month: input.expiryMonth,
            expiry_year: input.expiryYear,
            cvv: input.cvv,
            holder_name: input.cardholderName
          }
        },
        metadata: {
          ...input.metadata,
          user_id: input.userId,
          payment_type: input.paymentType,
          source: 'mobile_app',
          app_name: '60Seconds',
          timestamp: new Date().toISOString()
        }
      };

      console.log('📤 Calling Worldline API...');
      const apiPath = '/payments/directSale';
      const apiUrl = `${WORLDLINE_BASE_URL}${apiPath}`;
      console.log(`   URL: ${apiUrl}`);
      console.log(`   Method: POST`);
      
      // Worldline Direct API HMAC-SHA256 Authentication
      const httpMethod = 'POST';
      const contentType = 'application/json';
      const date = new Date().toUTCString();
      const bodyString = JSON.stringify(payload);
      
      // Create string to sign (Worldline format)
      const stringToSign = [
        httpMethod,
        contentType,
        date,
        `x-gcs-merchantid:${WORLDLINE_MERCHANT_ID}`,
        `/v2${apiPath}`  // Full path for signing
      ].join('\n');
      
      // Calculate HMAC-SHA256 signature
      const signature = crypto
        .createHmac('sha256', WORLDLINE_API_KEY)
        .update(stringToSign)
        .digest('base64');
      
      // Format Authorization header: GCS v1HMAC:<API Key ID>:<Signature>
      const authorization = `GCS v1HMAC:${WORLDLINE_API_KEY_ID}:${signature}`;
      
      console.log(`   Auth: GCS v1HMAC with Key ID: ${WORLDLINE_API_KEY_ID.substring(0, 10)}...`);
      
      const response = await fetch(apiUrl, {
        method: httpMethod,
        headers: {
          'Authorization': authorization,
          'Content-Type': contentType,
          'Date': date,
          'X-GCS-MerchantId': WORLDLINE_MERCHANT_ID,
        },
        body: bodyString
      });

      console.log(`📥 Worldline API Response Status: ${response.status} ${response.statusText}`);

      // Check if response is JSON
      const responseContentType = response.headers.get('content-type');
      let data;
      
      if (responseContentType && responseContentType.includes('application/json')) {
        data = await response.json();
      } else {
        const textResponse = await response.text();
        console.error('Non-JSON response from Worldline:', textResponse);
        throw new Error(`Worldline API returned non-JSON response: ${textResponse}`);
      }

      if (!response.ok) {
        console.error('❌ Worldline API Error Response:', JSON.stringify(data, null, 2));
        throw new Error(data.message || `Worldline payment failed with status ${response.status}`);
      }

      console.log('✅ Worldline API Success!');
      console.log(`   Transaction ID: ${data.transaction_id || 'N/A'}`);
      console.log(`   Status: ${data.status || 'N/A'}`);
      console.log(`   Reference: ${data.reference || input.reference}`);
      console.log(`   Authorization URL: ${data.authorization_url ? data.authorization_url.substring(0, 50) + '...' : 'N/A'}`);
      console.log('');
      console.log('📊 Payment processed successfully');
      console.log(`   Search by reference: ${data.reference || input.reference}`);
      console.log('');

      const result = {
        success: true,
        data: {
          reference: data.reference || input.reference,
          status: data.status || 'success',
          authorization_url: data.authorization_url,
          access_code: data.access_code,
          message: data.message,
          gateway_response: data.gateway_response,
          transaction_id: data.transaction_id,
          amount: input.amount,
          currency: input.currency,
          customer: {
            email: input.email,
            name: input.cardholderName
          },
          authorization: data.authorization
        },
        message: data.message || 'Payment processed successfully'
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
      console.error('❌ Worldline direct card payment error:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      
      // Save failed payment to database
      try {
        await saveFailedPaymentToDatabase({
          ...input,
          error: error.message
        });
      } catch (dbError) {
        console.error('Failed to save payment error to database:', dbError);
      }

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
        message: error.message || 'Payment processing failed'
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
    console.log('💾 Saving Worldline payment to database...');
    
    // Create payment record
    const { error: paymentError } = await supabase
      .from('payments')
      .insert({
        user_id: params.userId,
        payment_provider: 'worldline',
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
      throw paymentError;
    }

    // If payment is successful and has authorization data, save payment method
    if (params.response.status === 'success' && params.response.authorization) {
      const { error: paymentMethodError } = await supabase
        .from('payment_methods')
        .insert({
          user_id: params.userId,
          type: 'worldline_card',
          nickname: `${params.response.authorization.brand.toUpperCase()} ****${params.response.authorization.last4}`,
          is_default: false,
          provider: 'worldline',
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
            provider: 'worldline',
            card_type: 'credit_card',
            created_via: 'direct_card_payment',
            description: 'Worldline payment method setup'
          }
        });

      if (paymentMethodError) {
        console.error('❌ Error saving payment method:', paymentMethodError);
        // Don't throw here, payment was successful
      }
    }

    console.log('✅ Worldline payment saved to database successfully');
  } catch (error: any) {
    console.error('❌ Error saving Worldline payment to database:', error);
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
    console.log('💾 Saving failed Worldline payment to database...');
    
    const { error } = await supabase
      .from('payments')
      .insert({
        user_id: params.userId,
        payment_provider: 'worldline',
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
      console.log('✅ Failed Worldline payment saved to database');
    }
  } catch (error: any) {
    console.error('❌ Error saving failed Worldline payment to database:', error);
  }
}
