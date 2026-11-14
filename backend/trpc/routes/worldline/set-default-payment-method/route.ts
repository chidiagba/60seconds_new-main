import { logger } from '../../../../lib/logger';
import { z } from 'zod';
import { disabledProcedure } from '../../../create-context';
import { supabase } from '@/backend/lib/supabase';

export const setDefaultPaymentMethodProcedure = disabledProcedure
  .input(z.object({
    paymentMethodId: z.string(),
    userId: z.string(),
  }))
  .mutation(async ({ input }) => {
    try {
      logger.debug('Setting default Worldline payment method:', input.paymentMethodId);
      
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

      // Start a transaction to update all payment methods
      // First, set all payment methods for this user to not default
      const { error: unsetDefaultError } = await supabase
        .from('payment_methods')
        .update({ is_default: false })
        .eq('user_id', input.userId)
        .eq('provider', 'worldline');

      if (unsetDefaultError) {
        console.error('Error unsetting default payment methods:', unsetDefaultError);
        throw new Error('Failed to update payment methods');
      }

      // Then set the selected payment method as default
      const { error: setDefaultError } = await supabase
        .from('payment_methods')
        .update({ is_default: true })
        .eq('id', input.paymentMethodId)
        .eq('user_id', input.userId);

      if (setDefaultError) {
        console.error('Error setting default payment method:', setDefaultError);
        throw new Error('Failed to set default payment method');
      }

      logger.debug('✅ Default payment method set successfully');
      
      return {
        success: true,
        message: 'Default payment method set successfully'
      };
    } catch (error: any) {
      console.error('Set default payment method error:', error);
      return {
        success: false,
        message: 'Request could not be completed'
      };
    }
  });





