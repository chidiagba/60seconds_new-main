import { logger } from '@/lib/logger';
import { Platform } from 'react-native';
import { trpcClient } from '@/lib/trpc';
import { WORLDLINE_CONFIG } from '@/lib/worldline-config';

export interface WorldlineInitializeParams {
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

export interface WorldlinePaymentResponse {
  success: boolean;
  data: {
    paymentId: string;
    redirectUrl: string;
    orderId: string;
    amount: number;
    currency: string;
    status: string;
    expiresAt: string;
  };
}

export interface WorldlineVerifyResponse {
  success: boolean;
  data: {
    paymentId: string;
    orderId: string;
    amount: number;
    currency: string;
    status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
    transactionId?: string;
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

export interface WorldlineCustomer {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  address?: {
    street: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
  };
  metadata?: Record<string, any>;
}

export interface WorldlineDirectCardPaymentParams {
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

export interface WorldlineDirectCardPaymentResponse {
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

class WorldlineService {
  private static instance: WorldlineService;
  
  public static getInstance(): WorldlineService {
    if (!WorldlineService.instance) {
      WorldlineService.instance = new WorldlineService();
    }
    return WorldlineService.instance;
  }

  /**
   * Initialize a payment transaction with Worldline
   */
  async initializePayment(params: WorldlineInitializeParams): Promise<WorldlinePaymentResponse> {
    throw new Error('Payment provider is disabled. Use Stripe or Paystack.');
    try {
      logger.debug('Initializing Worldline payment:', params);
      
      const result = await trpcClient.worldline.initialize.mutate({
        amount: params.amount,
        currency: params.currency || 'USD',
        orderId: params.orderId,
        customerEmail: params.customerEmail,
        customerName: params.customerName,
        description: params.description,
        returnUrl: params.returnUrl,
        cancelUrl: params.cancelUrl,
        metadata: params.metadata,
      });
      
      if (!result.success) {
        throw new Error('Failed to initialize Worldline payment');
      }
      
      return result;
    } catch (error: any) {
      logger.error('Worldline initialization error:', error);
      throw new Error(error.message || 'Failed to initialize Worldline payment');
    }
  }

  /**
   * Verify a payment transaction
   */
  async verifyPayment(paymentId: string): Promise<WorldlineVerifyResponse> {
    throw new Error('Payment provider is disabled. Use Stripe or Paystack.');
    try {
      logger.debug('Verifying Worldline payment:', paymentId);
      
      const result = await trpcClient.worldline.verify.query({
        paymentId,
      });
      
      if (!result.success) {
        throw new Error('Failed to verify Worldline payment');
      }
      
      return result;
    } catch (error: any) {
      logger.error('Worldline verification error:', error);
      throw new Error(error.message || 'Failed to verify Worldline payment');
    }
  }

  /**
   * Create a customer in Worldline system
   */
  async createCustomer(customer: WorldlineCustomer) {
    throw new Error('Payment provider is disabled. Use Stripe or Paystack.');
    try {
      logger.debug('Creating Worldline customer:', customer.email);
      
      const result = await trpcClient.worldline.createCustomer.mutate(customer);
      
      if (!result.success) {
        throw new Error('Failed to create Worldline customer');
      }
      
      return result.data;
    } catch (error: any) {
      logger.error('Worldline customer creation error:', error);
      throw new Error(error.message || 'Failed to create Worldline customer');
    }
  }

  /**
   * Get customer details
   */
  async getCustomer(customerId: string) {
    throw new Error('Payment provider is disabled. Use Stripe or Paystack.');
    try {
      logger.debug('Getting Worldline customer:', customerId);
      
      const result = await trpcClient.worldline.getCustomer.query({
        customerId,
      });
      
      if (!result.success) {
        throw new Error('Failed to get Worldline customer');
      }
      
      return result.data;
    } catch (error: any) {
      logger.error('Worldline get customer error:', error);
      throw new Error(error.message || 'Failed to get Worldline customer');
    }
  }

  /**
   * Process direct card payment with Worldline
   */
  async processDirectCardPayment(params: WorldlineDirectCardPaymentParams): Promise<WorldlineDirectCardPaymentResponse> {
    throw new Error('Payment provider is disabled. Use Stripe or Paystack.');
    try {
      logger.debug('Processing Worldline direct card payment:', {
        email: params.email,
        amount: params.amount,
        currency: params.currency,
        reference: params.reference,
        cardNumber: params.cardNumber.replace(/\s/g, '').slice(0, 4) + '****',
        userId: params.userId
      });
      // Always use backend with real Worldline API - NO MOCK FALLBACK
      const result = await trpcClient.worldline.directCardPayment.mutate({
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

      return result as WorldlineDirectCardPaymentResponse;

    } catch (error: any) {
      logger.error('Worldline direct card payment error:', error);
      
      // Provide helpful error message
      let errorMessage = error.message || 'Payment processing failed';
      if (error.message && error.message.includes('Network request failed')) {
        errorMessage = 'Cannot connect to payment server. Please ensure the backend server is running on port 3001 and EXPO_PUBLIC_RORK_API_BASE_URL is set correctly.';
        logger.error('❌ Backend connection failed!');
        logger.error('💡 Make sure to:');
        logger.error('   1. Start server: yarn start-server');
        logger.error('   2. Set API URL: export EXPO_PUBLIC_RORK_API_BASE_URL=http://192.168.1.6:3001');
        logger.error('   3. Restart Expo app');
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
        message: errorMessage
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

  generateReference(prefix: string = 'worldline'): string {
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
    worldlineReference: string;
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
      logger.debug('💾 Saving Worldline payment method to Supabase...');
      
      // Import Supabase client
      const { supabase } = await import('@/lib/supabase');
      // Ensure we have a Supabase-authenticated user; use that id for RLS
      const { data: authData } = await supabase.auth.getUser();
      const authedUserId = authData?.user?.id;
      if (!authedUserId) {
        logger.debug('ℹ️ Skipping Supabase save: no authenticated user');
        return null;
      }
      const userIdForInsert = authedUserId;
      if (params.userId !== authedUserId) {
        logger.debug('ℹ️ Auth user differs from provided user; using authenticated user for insert');
      }
      
      // Map to existing schema columns. Store gateway details in metadata.
      const expiryDate = `${params.authorization.exp_month}/${params.authorization.exp_year.slice(-2)}`;

      const { data, error } = await supabase
        .from('payment_methods')
        .insert({
          user_id: userIdForInsert,
          type: 'worldline',
          nickname: params.nickname,
          is_default: params.isDefault,
          card_type: params.cardType,
          last_four: params.authorization.last4,
          expiry_date: expiryDate,
          // Keep worldline specific ids empty for now; can be set later if available
          worldline_customer_id: null,
          worldline_payment_method_id: null,
          metadata: {
            provider: 'worldline',
            provider_reference: params.worldlineReference,
            authorization: {
              code: params.authorization.authorization_code,
              last4: params.authorization.last4,
              exp_month: params.authorization.exp_month,
              exp_year: params.authorization.exp_year,
              brand: params.authorization.brand,
              bank: params.authorization.bank,
              country_code: params.authorization.country_code,
            },
            nickname: params.nickname,
            created_via: 'direct_card_payment',
            description: 'Worldline payment method setup'
          }
        })
        .select()
        .single();

      if (error) {
        logger.error('❌ Supabase save error:', error);
        throw error;
      }

      logger.debug('✅ Worldline payment method saved to Supabase:', data);
      return data;
    } catch (error: any) {
      logger.error('❌ Error saving Worldline payment method to Supabase:', error);
      throw error;
    }
  }

  /**
   * Open Worldline checkout (web only)
   */
  async openCheckout(params: WorldlineInitializeParams): Promise<string> {
    throw new Error('Payment provider is disabled. Use Stripe or Paystack.');
    if (Platform.OS !== 'web') {
      throw new Error('Worldline checkout is only available on web platform');
    }

    try {
      // Initialize payment first
      const paymentData = await this.initializePayment(params);
      
      // Open the redirect URL in a new window
      const popup = window.open(
        paymentData.data.redirectUrl,
        'worldline-checkout',
        'width=500,height=600,scrollbars=yes,resizable=yes'
      );

      if (!popup) {
        throw new Error('Popup blocked. Please allow popups for this site.');
      }

      // Return a promise that resolves when payment is complete
      return new Promise((resolve, reject) => {
        const checkClosed = setInterval(() => {
          if (popup?.closed) {
            clearInterval(checkClosed);
            // Check if payment was successful by verifying the payment ID
            this.verifyPayment(paymentData.data.paymentId)
              .then((verification) => {
                if (verification.data.status === 'SUCCESS') {
                  resolve(paymentData.data.paymentId);
                } else {
                  reject(new Error('Payment was not completed'));
                }
              })
              .catch(() => {
                reject(new Error('Payment verification failed'));
              });
          }
        }, 1000);

        // Timeout after 10 minutes
        setTimeout(() => {
          clearInterval(checkClosed);
          if (!popup?.closed) {
            popup?.close();
          }
          reject(new Error('Payment timeout'));
        }, 600000);
      });
    } catch (error: any) {
      logger.error('Worldline checkout error:', error);
      throw error;
    }
  }

  /**
   * Format amount for display
   */
  formatAmount(amount: number, currency: string = 'USD'): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(amount);
  }

  /**
   * Get supported payment methods
   */
  getSupportedPaymentMethods(): string[] {
    return [
      'credit_card',
      'debit_card',
      'bank_transfer',
      'digital_wallet',
      'buy_now_pay_later',
      'bank_redirect',
    ];
  }

  /**
   * Get payment method display names
   */
  getPaymentMethodDisplayName(method: string): string {
    const methodNames: Record<string, string> = {
      credit_card: 'Credit Card',
      debit_card: 'Debit Card',
      bank_transfer: 'Bank Transfer',
      digital_wallet: 'Digital Wallet',
      buy_now_pay_later: 'Buy Now, Pay Later',
      bank_redirect: 'Bank Redirect',
    };
    
    return methodNames[method] || method;
  }

  /**
   * Get supported currencies
   */
  getSupportedCurrencies(): string[] {
    return ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD'];
  }

  /**
   * Check if currency is supported
   */
  isCurrencySupported(currency: string): boolean {
    return this.getSupportedCurrencies().includes(currency.toUpperCase());
  }

  /**
   * Check if real Worldline keys are configured
   */
  isRealWorldlineKey(): boolean {
    const { MERCHANT_ID, API_KEY } = WORLDLINE_CONFIG;
    return Boolean(MERCHANT_ID && 
           API_KEY && 
           MERCHANT_ID !== 'your_merchant_id_here' && 
           API_KEY !== 'your_api_key_here' &&
           API_KEY.length > 20); // Basic validation
  }

  /**
   * Get user's payment methods
   */
  async getPaymentMethods(userId: string) {
    throw new Error('Payment provider is disabled. Use Stripe or Paystack.');
    try {
      logger.debug('Getting Worldline payment methods for user:', userId);
      
      const result = await trpcClient.worldline.getPaymentMethods.query({
        userId,
      });
      
      return result;
    } catch (error: any) {
      logger.error('Worldline get payment methods error:', error);
      return {
        success: false,
        data: [],
        message: error.message || 'Failed to get payment methods'
      };
    }
  }

  /**
   * Delete a payment method
   */
  async deletePaymentMethod(paymentMethodId: string, userId: string) {
    throw new Error('Payment provider is disabled. Use Stripe or Paystack.');
    try {
      logger.debug('Deleting Worldline payment method:', paymentMethodId);
      
      const result = await trpcClient.worldline.deletePaymentMethod.mutate({
        paymentMethodId,
        userId,
      });
      
      return result;
    } catch (error: any) {
      logger.error('Worldline delete payment method error:', error);
      return {
        success: false,
        message: error.message || 'Failed to delete payment method'
      };
    }
  }

  /**
   * Set default payment method
   */
  async setDefaultPaymentMethod(paymentMethodId: string, userId: string) {
    throw new Error('Payment provider is disabled. Use Stripe or Paystack.');
    try {
      logger.debug('Setting default Worldline payment method:', paymentMethodId);
      
      const result = await trpcClient.worldline.setDefaultPaymentMethod.mutate({
        paymentMethodId,
        userId,
      });
      
      return result;
    } catch (error: any) {
      logger.error('Worldline set default payment method error:', error);
      return {
        success: false,
        message: error.message || 'Failed to set default payment method'
      };
    }
  }

  /**
   * Get payment history
   */
  async getPaymentHistory(userId: string, limit: number = 20, offset: number = 0) {
    throw new Error('Payment provider is disabled. Use Stripe or Paystack.');
    try {
      logger.debug('Getting Worldline payment history for user:', userId);
      
      const result = await trpcClient.worldline.getPaymentHistory.query({
        userId,
        limit,
        offset,
      });
      
      return result;
    } catch (error: any) {
      logger.error('Worldline get payment history error:', error);
      return {
        success: false,
        data: {
          payments: [],
          total: 0,
          limit,
          offset,
          hasMore: false
        },
        message: error.message || 'Failed to get payment history'
      };
    }
  }

  /**
   * Create a Worldline session
   */
  async createSession(params: {
    customerId?: string;
    paymentContext?: {
      amountOfMoney: {
        amount: number;
        currencyCode: string;
      };
      countryCode: string;
      locale: string;
      isRecurring: boolean;
    };
  }) {
    throw new Error('Payment provider is disabled. Use Stripe or Paystack.');
    try {
      logger.debug('Creating Worldline session...');
      
      const result = await trpcClient.worldline.createSession.mutate(params);
      
      return result;
    } catch (error: any) {
      logger.error('Worldline session creation error:', error);
      return {
        success: false,
        data: null,
        message: error.message || 'Failed to create session'
      };
    }
  }

  /**
   * Get configuration status
   */
  getConfigStatus(): {
    hasMerchantId: boolean;
    hasApiKey: boolean;
    isConfigured: boolean;
    isTestMode: boolean;
  } {
    const { MERCHANT_ID, API_KEY, IS_TEST_MODE } = WORLDLINE_CONFIG;
    
    return {
      hasMerchantId: Boolean(MERCHANT_ID && MERCHANT_ID !== 'your_merchant_id_here'),
      hasApiKey: Boolean(API_KEY && API_KEY !== 'your_api_key_here'),
      isConfigured: this.isRealWorldlineKey(),
      isTestMode: IS_TEST_MODE,
    };
  }
}

export default WorldlineService.getInstance();



