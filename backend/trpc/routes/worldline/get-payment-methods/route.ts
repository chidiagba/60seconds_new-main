import { z } from 'zod';
import { publicProcedure } from '../../../create-context';
import { supabase } from '@/backend/lib/supabase';

export const getPaymentMethodsProcedure = publicProcedure
  .input(z.object({
    userId: z.string(),
  }))
  .query(async ({ input }) => {
    try {
      console.log('Getting Worldline payment methods for user:', input.userId);
      
      const { data: paymentMethods, error } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('user_id', input.userId)
        .eq('provider', 'worldline')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching payment methods:', error);
        throw new Error('Failed to fetch payment methods');
      }

      return {
        success: true,
        data: paymentMethods || [],
        message: 'Payment methods retrieved successfully'
      };
    } catch (error: any) {
      console.error('Get payment methods error:', error);
      return {
        success: false,
        data: [],
        message: error.message || 'Failed to retrieve payment methods'
      };
    }
  });





