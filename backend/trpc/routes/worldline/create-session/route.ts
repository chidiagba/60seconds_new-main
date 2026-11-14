import { logger } from '../../../../lib/logger';
import { z } from 'zod';
import { disabledProcedure } from '../../../create-context';

// Worldline API Configuration - PSPID is the Merchant ID
const WORLDLINE_MERCHANT_ID = process.env.WORLDLINE_MERCHANT_ID || '60secondsTechnologies';
const WORLDLINE_API_KEY = process.env.WORLDLINE_API_KEY || '';
const WORLDLINE_BASE_URL = process.env.WORLDLINE_BASE_URL || 'https://payment.direct.worldline-solutions.com/v2';

export const createSessionProcedure = disabledProcedure
  .input(z.object({
    customerId: z.string().optional(),
    paymentContext: z.object({
      amountOfMoney: z.object({
        amount: z.number().positive(),
        currencyCode: z.string().default('USD'),
      }),
      countryCode: z.string().default('US'),
      locale: z.string().default('en_US'),
      isRecurring: z.boolean().default(false),
    }).optional(),
  }))
  .mutation(async ({ input }) => {
    try {
      logger.debug('Creating Worldline session...');
      
      // Check if using real Worldline keys
      const isRealWorldlineKey = Boolean(
        WORLDLINE_MERCHANT_ID && 
        WORLDLINE_API_KEY && 
        WORLDLINE_MERCHANT_ID !== 'your_merchant_id_here' && 
        WORLDLINE_API_KEY !== 'your_api_key_here' &&
        WORLDLINE_API_KEY.length > 20
      );
      
      if (!isRealWorldlineKey) {
        logger.debug('🧪 Using mock Worldline session (no real keys configured)');
        
        // Mock session for testing
        return {
          success: true,
          data: {
            clientSessionId: `mock_session_${Date.now()}`,
            customerId: input.customerId || `mock_customer_${Date.now()}`,
            assetUrl: 'https://assets.worldline-solutions.com',
            clientApiUrl: 'https://clientapi.worldline-solutions.com',
            isMock: true,
          },
          message: 'Mock session created successfully'
        };
      }

      // Real Worldline API call to create session
      const payload = {
        paymentProductFilters: {
          restrictTo: {
            countryCode: input.paymentContext?.countryCode || 'US',
            currencyCode: input.paymentContext?.amountOfMoney?.currencyCode || 'USD',
          },
        },
        ...(input.customerId && { customerId: input.customerId }),
        ...(input.paymentContext && { paymentContext: input.paymentContext }),
      };

      const response = await fetch(`${WORLDLINE_BASE_URL}/v1/sessions`, {
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
        throw new Error(data.message || 'Failed to create Worldline session');
      }

      return {
        success: true,
        data: {
          clientSessionId: data.clientSessionId,
          customerId: data.customerId,
          assetUrl: data.assetUrl,
          clientApiUrl: data.clientApiUrl,
          isMock: false,
        },
        message: 'Session created successfully'
      };

    } catch (error: any) {
      console.error('Worldline session creation error:', error);
      
      // Return mock session on error for development
      return {
        success: true,
        data: {
          clientSessionId: `error_session_${Date.now()}`,
          customerId: input.customerId || `error_customer_${Date.now()}`,
          assetUrl: 'https://assets.worldline-solutions.com',
          clientApiUrl: 'https://clientapi.worldline-solutions.com',
          isMock: true,
        },
        message: 'Mock session created due to error'
      };
    }
  });





