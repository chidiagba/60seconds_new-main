import { logger } from '@/lib/logger';
import { supabase } from './supabase';
import { trpcClient } from './trpc';
import WorldlineService from './worldline';
import PaystackService from './paystack';

export interface PaymentRequest {
  orderId: string;
  userId: string;
  amount: number;
  currency: string;
  paymentMethodId: string;
  paymentProvider: 'internal' | 'twint' | 'paystack' | 'worldline';
  metadata?: Record<string, any>;
}

export interface PaymentResponse {
  success: boolean;
  paymentId?: string;
  transactionId?: string;
  gatewayReference?: string;
  redirectUrl?: string;
  error?: string;
}

export interface PaymentVerification {
  success: boolean;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'refunded';
  transactionId?: string;
  gatewayResponse?: any;
  error?: string;
}

class PaymentService {
  private static instance: PaymentService;
  
  public static getInstance(): PaymentService {
    if (!PaymentService.instance) {
      PaymentService.instance = new PaymentService();
    }
    return PaymentService.instance;
  }

  /**
   * Process a payment request
   */
  async processPayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      if (request.paymentProvider === 'worldline') throw new Error('Payment provider is disabled');

      // Get payment method details
      const paymentMethod = await this.getPaymentMethod(request.paymentMethodId);
      if (!paymentMethod) {
        throw new Error('Payment method not found');
      }

      // Create payment record in database
      const paymentRecord = await this.createPaymentRecord({
        order_id: request.orderId,
        user_id: request.userId,
        payment_provider: request.paymentProvider,
        payment_method_id: request.paymentMethodId,
        amount: request.amount,
        currency: request.currency,
        status: 'pending',
        metadata: request.metadata,
      });

      let paymentResponse: PaymentResponse;

      // Process payment based on provider
      switch (request.paymentProvider) {
        case 'internal':
          paymentResponse = await this.processInternalPayment(request, paymentRecord.id);
          break;
        case 'twint':
          paymentResponse = await this.processTwintPayment(request, paymentRecord.id);
          break;
        case 'paystack':
          paymentResponse = await this.processPaystackPayment(request, paymentRecord.id);
          break;

        default:
          throw new Error(`Unsupported payment provider: ${request.paymentProvider}`);
      }

      // Update payment record with response
      await this.updatePaymentRecord(paymentRecord.id, {
        transaction_id: paymentResponse.transactionId,
        gateway_reference: paymentResponse.gatewayReference,
        status: paymentResponse.success ? 'processing' : 'failed',
        failure_reason: paymentResponse.error,
      });

      return paymentResponse;
    } catch (error: any) {
      logger.error('Payment processing error:', error);
      return {
        success: false,
        error: error.message || 'Payment processing failed',
      };
    }
  }

  /**
   * Verify a payment
   */
  async verifyPayment(paymentId: string, provider: string): Promise<PaymentVerification> {
    try {
      logger.debug('Verifying payment:', paymentId, 'with provider:', provider);

      let verification: PaymentVerification;

      switch (provider) {
        case 'paystack':
          verification = await this.verifyPaystackPayment(paymentId);
          break;
        case 'worldline':
          verification = await this.verifyWorldlinePayment(paymentId);
          break;
        case 'internal':
        case 'twint':
          // For internal and Twint, we assume success for demo purposes
          verification = { success: true, status: 'completed' };
          break;
        default:
          throw new Error(`Unsupported payment provider for verification: ${provider}`);
      }

      // Update payment record
      await this.updatePaymentRecord(paymentId, {
        status: verification.status,
        gateway_response: verification.gatewayResponse,
        completed_at: verification.status === 'completed' ? new Date().toISOString() : null,
        failed_at: verification.status === 'failed' ? new Date().toISOString() : null,
      });

      return verification;
    } catch (error: any) {
      logger.error('Payment verification error:', error);
      return {
        success: false,
        status: 'failed',
        error: error.message || 'Payment verification failed',
      };
    }
  }

  /**
   * Get payment method by ID
   */
  private async getPaymentMethod(paymentMethodId: string) {
    const { data, error } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('id', paymentMethodId)
      .eq('is_active', true)
      .single();

    if (error) {
      logger.error('Error fetching payment method:', error);
      return null;
    }

    return data;
  }

  /**
   * Create payment record in database
   */
  private async createPaymentRecord(paymentData: any) {
    const { data, error } = await supabase
      .from('payments')
      .insert(paymentData)
      .select()
      .single();

    if (error) {
      logger.error('Error creating payment record:', error);
      throw new Error('Failed to create payment record');
    }

    return data;
  }

  /**
   * Update payment record
   */
  private async updatePaymentRecord(paymentId: string, updates: any) {
    const { error } = await supabase
      .from('payments')
      .update(updates)
      .eq('id', paymentId);

    if (error) {
      logger.error('Error updating payment record:', error);
      throw new Error('Failed to update payment record');
    }
  }

  /**
   * Process internal payment (wallet)
   */
  private async processInternalPayment(request: PaymentRequest, paymentId: string): Promise<PaymentResponse> {
    // For internal payments, we assume success for demo purposes
    // In a real app, this would check wallet balance and deduct funds
    return {
      success: true,
      paymentId,
      transactionId: `internal_${Date.now()}`,
    };
  }

  /**
   * Process Twint payment
   */
  private async processTwintPayment(request: PaymentRequest, paymentId: string): Promise<PaymentResponse> {
    // For Twint, we simulate the payment process
    // In a real app, this would integrate with Twint's API
    return {
      success: true,
      paymentId,
      transactionId: `twint_${Date.now()}`,
      redirectUrl: `twint://payment?amount=${request.amount}&currency=${request.currency}`,
    };
  }

  /**
   * Process Paystack payment
   */
  private async processPaystackPayment(request: PaymentRequest, paymentId: string): Promise<PaymentResponse> {
    try {
      const paystackService = PaystackService;
      
      // Get user email from payment method or user profile
      const paymentMethod = await this.getPaymentMethod(request.paymentMethodId);
      const userEmail = paymentMethod?.paystack_email || 'user@example.com';

      const paymentData = await paystackService.initializePayment({
        email: userEmail,
        amount: request.amount,
        currency: request.currency,
        reference: `60seconds_${paymentId}`,
        metadata: {
          ...request.metadata,
          paymentId,
          orderId: request.orderId,
        },
      });

      return {
        success: true,
        paymentId,
        transactionId: paymentData.data.reference,
        gatewayReference: paymentData.data.reference,
        redirectUrl: paymentData.data.authorization_url,
      };
    } catch (error: any) {
      logger.error('Paystack payment error:', error);
      return {
        success: false,
        error: error.message || 'Paystack payment failed',
      };
    }
  }

  /**
   * Process Worldline payment
   */
  private async processWorldlinePayment(request: PaymentRequest, paymentId: string): Promise<PaymentResponse> {
    try {
      const worldlineService = WorldlineService;
      
      // Get user email from payment method or user profile
      const paymentMethod = await this.getPaymentMethod(request.paymentMethodId);
      const userEmail = paymentMethod?.worldline_customer_id ? 'user@example.com' : 'user@example.com';

      const paymentData = await worldlineService.initializePayment({
        amount: request.amount,
        currency: request.currency,
        orderId: request.orderId,
        customerEmail: userEmail,
        metadata: {
          ...request.metadata,
          paymentId,
        },
      });

      return {
        success: true,
        paymentId,
        transactionId: paymentData.data.paymentId,
        gatewayReference: paymentData.data.paymentId,
        redirectUrl: paymentData.data.redirectUrl,
      };
    } catch (error: any) {
      logger.error('Worldline payment error:', error);
      return {
        success: false,
        error: error.message || 'Worldline payment failed',
      };
    }
  }

  /**
   * Verify Paystack payment
   */
  private async verifyPaystackPayment(paymentId: string): Promise<PaymentVerification> {
    try {
      const paystackService = PaystackService;
      const verification = await paystackService.verifyPayment(paymentId);

      return {
        success: verification.success,
        status: verification.data.status === 'success' ? 'completed' : 'failed',
        transactionId: verification.data.reference,
        gatewayResponse: verification.data,
      };
    } catch (error: any) {
      logger.error('Paystack verification error:', error);
      return {
        success: false,
        status: 'failed',
        error: error.message || 'Paystack verification failed',
      };
    }
  }

  /**
   * Verify Worldline payment
   */
  private async verifyWorldlinePayment(paymentId: string): Promise<PaymentVerification> {
    try {
      const worldlineService = WorldlineService;
      const verification = await worldlineService.verifyPayment(paymentId);

      return {
        success: verification.success,
        status: verification.data.status === 'SUCCESS' ? 'completed' : 'failed',
        transactionId: verification.data.paymentId,
        gatewayResponse: verification.data,
      };
    } catch (error: any) {
      logger.error('Worldline verification error:', error);
      return {
        success: false,
        status: 'failed',
        error: error.message || 'Worldline verification failed',
      };
    }
  }

  /**
   * Get payment history for a user
   */
  async getUserPayments(userId: string, limit = 20, offset = 0) {
    const { data, error } = await supabase
      .from('payments')
      .select(`
        *,
        orders (
          id,
          order_number,
          total_amount,
          currency,
          status,
          created_at
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Error fetching user payments:', error);
      throw error;
    }

    return data;
  }

  /**
   * Get payment methods for a user
   */
  async getUserPaymentMethods(userId: string) {
    const { data, error } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching user payment methods:', error);
      throw error;
    }

    return data;
  }

  /**
   * Add a new payment method
   */
  async addPaymentMethod(userId: string, paymentMethodData: any) {
    const { data, error } = await supabase
      .from('payment_methods')
      .insert({
        ...paymentMethodData,
        user_id: userId,
      })
      .select()
      .single();

    if (error) {
      logger.error('Error adding payment method:', error);
      throw error;
    }

    return data;
  }

  /**
   * Update payment method
   */
  async updatePaymentMethod(paymentMethodId: string, updates: any) {
    const { data, error } = await supabase
      .from('payment_methods')
      .update(updates)
      .eq('id', paymentMethodId)
      .select()
      .single();

    if (error) {
      logger.error('Error updating payment method:', error);
      throw error;
    }

    return data;
  }

  /**
   * Delete payment method
   */
  async deletePaymentMethod(paymentMethodId: string) {
    const { error } = await supabase
      .from('payment_methods')
      .update({ is_active: false })
      .eq('id', paymentMethodId);

    if (error) {
      logger.error('Error deleting payment method:', error);
      throw error;
    }
  }

  /**
   * Set default payment method
   */
  async setDefaultPaymentMethod(userId: string, paymentMethodId: string) {
    // First, set all payment methods to not default
    await supabase
      .from('payment_methods')
      .update({ is_default: false })
      .eq('user_id', userId);

    // Then set the specified one as default
    const { data, error } = await supabase
      .from('payment_methods')
      .update({ is_default: true })
      .eq('id', paymentMethodId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      logger.error('Error setting default payment method:', error);
      throw error;
    }

    return data;
  }
}

export default PaymentService.getInstance();














