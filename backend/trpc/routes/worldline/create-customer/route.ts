import { z } from 'zod';
import { publicProcedure } from '../../../create-context';

// Worldline API Configuration - PSPID is the Merchant ID
const WORLDLINE_MERCHANT_ID = process.env.WORLDLINE_MERCHANT_ID || '60secondsTechnologies';
const WORLDLINE_API_KEY = process.env.WORLDLINE_API_KEY || '43A1D436F54844DB73BF153ECBA9551A27636D945271483D0D0B62D713CDAB5C8B15F5158D9339FCA9EA4BD0C92678F94FC930FF3A3355BB1DC1856530B3D730';
const WORLDLINE_BASE_URL = process.env.WORLDLINE_BASE_URL || 'https://payment.direct.worldline-solutions.com/v2';

export const createCustomerProcedure = publicProcedure
  .input(z.object({
    email: z.string().email(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    phone: z.string().optional(),
    address: z.object({
      street: z.string(),
      city: z.string(),
      state: z.string(),
      country: z.string(),
      postalCode: z.string(),
    }).optional(),
    metadata: z.record(z.any()).optional(),
  }))
  .mutation(async ({ input }) => {
    try {
      const payload = {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        address: input.address,
        metadata: {
          ...input.metadata,
          app_name: '60Seconds',
          created_at: new Date().toISOString(),
        },
      };
      
      const response = await fetch(`${WORLDLINE_BASE_URL}/v1/customers`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WORLDLINE_API_KEY}`,
          'Content-Type': 'application/json',
          'X-Merchant-Id': WORLDLINE_MERCHANT_ID,
        },
        body: JSON.stringify(payload),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to create Worldline customer');
      }
      
      if (!data.success) {
        throw new Error(data.message || 'Worldline customer creation failed');
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
        },
      };
    } catch (error: any) {
      console.error('Worldline customer creation error:', error);
      
      // For development/testing, return mock data
      if (process.env.NODE_ENV === 'development') {
        console.log('Returning mock Worldline customer data for development');
        return {
          success: true,
          data: {
            customerId: `cust_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            email: input.email,
            firstName: input.firstName,
            lastName: input.lastName,
            phone: input.phone,
            address: input.address,
            metadata: {
              ...input.metadata,
              app_name: '60Seconds',
              created_at: new Date().toISOString(),
            },
            createdAt: new Date().toISOString(),
          },
        };
      }
      
      throw new Error(error.message || 'Failed to create Worldline customer');
    }
  });







