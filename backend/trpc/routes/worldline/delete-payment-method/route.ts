import { z } from 'zod';
import { publicProcedure } from '../../../create-context';
import { supabase } from '@/backend/lib/supabase';

export const deletePaymentMethodProcedure = publicProcedure
  .input(z.object({
    paymentMethodId: z.string(),
    userId: z.string(),
  }))
  .mutation(async ({ input }) => {
    try {
      console.log('Deleting Worldline payment method:', input.paymentMethodId);
      
      // First, verify the payment method belongs to the user
      const { data: paymentMethod, error: fetchError } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('id', input.paymentMethodId)
        .eq('user_id', input.userId)
        .eq('provider', 'worldline')
        .single();

      if (fetchError || !paymentMethod) {
        throw new Error('Payment method not found or access denied');
      }

      // Delete the payment method
      const { error: deleteError } = await supabase
        .from('payment_methods')
        .delete()
        .eq('id', input.paymentMethodId)
        .eq('user_id', input.userId);

      if (deleteError) {
        console.error('Error deleting payment method:', deleteError);
        throw new Error('Failed to delete payment method');
      }

      console.log('✅ Payment method deleted successfully');
      
      return {
        success: true,
        message: 'Payment method deleted successfully'
      };
    } catch (error: any) {
      console.error('Delete payment method error:', error);
      return {
        success: false,
        message: error.message || 'Failed to delete payment method'
      };
    }
  });





