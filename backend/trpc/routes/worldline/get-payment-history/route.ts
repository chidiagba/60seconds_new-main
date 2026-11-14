import { logger } from '../../../../lib/logger';
import { z } from 'zod';
import { disabledProcedure } from '../../../create-context';
import { supabase } from '@/backend/lib/supabase';

export const getPaymentHistoryProcedure = disabledProcedure
  .input(z.object({
    userId: z.string(),
    limit: z.number().min(1).max(100).default(20),
    offset: z.number().min(0).default(0),
  }))
  .query(async ({ input }) => {
    try {
      logger.debug('Getting Worldline payment history for user:', input.userId);
      
      const { data: payments, error } = await supabase
        .from('payments')
        .select('*')
        .eq('user_id', input.userId)
        .eq('payment_provider', 'worldline')
        .order('created_at', { ascending: false })
        .range(input.offset, input.offset + input.limit - 1);

      if (error) {
        console.error('Error fetching payment history:', error);
        throw new Error('Failed to fetch payment history');
      }

      // Get total count for pagination
      const { count, error: countError } = await supabase
        .from('payments')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', input.userId)
        .eq('payment_provider', 'worldline');

      if (countError) {
        console.error('Error fetching payment count:', countError);
      }

      return {
        success: true,
        data: {
          payments: payments || [],
          total: count || 0,
          limit: input.limit,
          offset: input.offset,
          hasMore: (count || 0) > input.offset + input.limit
        },
        message: 'Payment history retrieved successfully'
      };
    } catch (error: any) {
      console.error('Get payment history error:', error);
      return {
        success: false,
        data: {
          payments: [],
          total: 0,
          limit: input.limit,
          offset: input.offset,
          hasMore: false
        },
        message: 'Request could not be completed'
      };
    }
  });





