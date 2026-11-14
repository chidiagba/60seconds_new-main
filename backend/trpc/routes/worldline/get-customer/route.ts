import { logger } from '../../../../lib/logger';
import { z } from 'zod';
import { disabledProcedure } from '../../../create-context';

// Worldline API Configuration - PSPID is the Merchant ID
const WORLDLINE_MERCHANT_ID = process.env.WORLDLINE_MERCHANT_ID || '60secondsTechnologies';
const WORLDLINE_API_KEY = process.env.WORLDLINE_API_KEY || '';
const WORLDLINE_BASE_URL = process.env.WORLDLINE_BASE_URL || 'https://payment.direct.worldline-solutions.com/v2';

export const getCustomerProcedure = disabledProcedure
  .input(z.object({
    customerId: z.string(),
  }))
  .query(async ({ input }) => {
    try {
      const response = await fetch(`${WORLDLINE_BASE_URL}/v1/customers/${input.customerId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${WORLDLINE_API_KEY}`,
          'Content-Type': 'application/json',
          'X-Merchant-Id': WORLDLINE_MERCHANT_ID,
        },
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to get Worldline customer');
      }
      
      if (!data.success) {
        throw new Error(data.message || 'Worldline customer retrieval failed');
      }
      
      return {
        success: true,
        data: {
          customerId: data.customerId,
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          address: data.address,
          metadata: data.metadata,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        },
      };
    } catch (error: any) {
      console.error('Worldline get customer error:', error);
      
      // For development/testing, return mock data
      if (process.env.NODE_ENV === 'development') {
        logger.debug('Returning mock Worldline customer data for development');
        return {
          success: true,
          data: {
            customerId: input.customerId,
            email: 'test@example.com',
            firstName: 'Test',
            lastName: 'Customer',
            phone: '+1234567890',
            address: {
              street: '123 Test Street',
              city: 'Test City',
              state: 'Test State',
              country: 'US',
              postalCode: '12345',
            },
            metadata: {
              app_name: '60Seconds',
              created_at: new Date().toISOString(),
            },
            createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
            updatedAt: new Date().toISOString(),
          },
        };
      }
      
      throw new Error(error.message || 'Failed to get Worldline customer');
    }
  });



