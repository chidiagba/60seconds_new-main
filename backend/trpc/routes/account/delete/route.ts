import { logger } from '../../../../lib/logger';
import { z } from 'zod';
import { protectedProcedure } from '../../../create-context';
import { supabase } from '@/backend/lib/supabase';

export const deleteAccountProcedure = protectedProcedure
  .input(z.object({
    userId: z.string().uuid(),
    email: z.string().email().optional(),
    reason: z.string().optional(),
  }))
  .mutation(async ({ input, ctx }) => {
    if (!supabase) {
      throw new Error('Supabase client not configured');
    }

    try {
      logger.debug('🗑️ Deleting account:', {
        userId: ctx.user.id,
        email: input.email,
        reason: input.reason,
      });

      // Clean up user-related data in key tables before deleting the auth user
      const tablesToClean = [
        { table: 'videos', column: 'user_id' },
        { table: 'orders', column: 'user_id' },
        { table: 'payment_methods', column: 'user_id' },
        { table: 'vouchers', column: 'business_id' },
        { table: 'profiles', column: 'id' },
      ];

      for (const { table, column } of tablesToClean) {
        try {
          const { error } = await supabase
            .from(table)
            .delete()
            .eq(column, ctx.user.id);

          if (error && error.code !== 'PGRST116') {
            console.warn(`⚠️ Failed to delete from ${table}:`, error);
          } else {
            logger.debug(`✅ Cleaned data from ${table}`);
          }
        } catch (tableError) {
          console.warn(`⚠️ Error cleaning table ${table}:`, tableError);
        }
      }

      const { error: deleteUserError } = await supabase.auth.admin.deleteUser(ctx.user.id);

      if (deleteUserError) {
        console.error('❌ Failed to delete auth user:', deleteUserError);
        throw deleteUserError;
      }

      logger.debug('✅ Account deleted successfully');

      return {
        success: true,
        message: 'Account deleted successfully',
      };
    } catch (error: unknown) {
      console.error('❌ Delete account error:', error);

      return {
        success: false,
        message: 'Request could not be completed',
      };
    }
  });











