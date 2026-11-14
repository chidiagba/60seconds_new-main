import { logger } from '../../../../lib/logger';
import { requiredEnv } from '@/backend/lib/env';
import { z } from 'zod';
import { protectedProcedure } from '../../../create-context';

const PAYSTACK_SECRET_KEY = requiredEnv('PAYSTACK_SECRET_KEY');

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

export const createCustomerProcedure = protectedProcedure
  .input(z.object({
    email: z.string().email(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    phone: z.string().optional(),
    metadata: z.record(z.any()).optional(),
  }))
  .mutation(async ({ input, ctx }) => {
    try {
      logger.debug('🚀 Creating Paystack customer with input:', input);
      logger.debug('🔑 Using Paystack secret key:', PAYSTACK_SECRET_KEY ? 'Set' : 'Not set');
      logger.debug('🌐 Paystack base URL:', PAYSTACK_BASE_URL);
      
      const response = await fetch(`${PAYSTACK_BASE_URL}/customer`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: ctx.user.email,
          first_name: input.first_name,
          last_name: input.last_name,
          phone: input.phone,
          metadata: {
            ...input.metadata,
            app_name: '60Seconds',
            created_at: new Date().toISOString(),
          },
        }),
      });
      
      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('JSON parse error:', jsonError);
        const responseText = await response.text();
        console.error('Response text:', responseText);
        throw new Error(`Invalid response from Paystack API: ${responseText}`);
      }
      
      if (!response.ok) {
        console.error('Paystack API error:', data);
        throw new Error(data?.message || `HTTP ${response.status}: Failed to create customer`);
      }
      
      if (!data.status) {
        console.error('Paystack API status error:', data);
        throw new Error(data.message || 'Customer creation failed');
      }
      
      return {
        success: true,
        data: {
          id: data.data.id,
          customer_code: data.data.customer_code,
          email: data.data.email,
          first_name: data.data.first_name,
          last_name: data.data.last_name,
          phone: data.data.phone,
          metadata: data.data.metadata,
          created_at: data.data.createdAt,
        },
      };
    } catch (error: any) {
      console.error('Paystack customer creation error:', error);
      throw new Error(error.message || 'Failed to create customer');
    }
  });

export const getCustomerProcedure = protectedProcedure
  .input(z.object({
    email_or_code: z.string(),
  }))
  .query(async ({ input, ctx }) => {
    try {
      const response = await fetch(`${PAYSTACK_BASE_URL}/customer/${encodeURIComponent(ctx.user.email || "")}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to get customer');
      }
      
      if (!data.status) {
        throw new Error(data.message || 'Customer not found');
      }
      
      return {
        success: true,
        data: {
          id: data.data.id,
          customer_code: data.data.customer_code,
          email: data.data.email,
          first_name: data.data.first_name,
          last_name: data.data.last_name,
          phone: data.data.phone,
          metadata: data.data.metadata,
          created_at: data.data.createdAt,
          updated_at: data.data.updatedAt,
        },
      };
    } catch (error: any) {
      console.error('Paystack get customer error:', error);
      throw new Error(error.message || 'Failed to get customer');
    }
  });