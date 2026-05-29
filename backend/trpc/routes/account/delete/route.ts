import { z } from 'zod';
import { publicProcedure } from '../../../create-context';
import { supabase } from '@/backend/lib/supabase';

export const deleteAccountProcedure = publicProcedure
  .input(z.object({
    userId: z.string().uuid(),
    email: z.string().email().optional(),
    reason: z.string().optional(),
  }))
  .mutation(async ({ input }) => {
    if (!supabase) {
      throw new Error('Supabase client not configured');
    }

    try {
      console.log('🗑️ Deleting account:', {
        userId: input.userId,
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
            .from(table as any)
            .delete()
            .eq(column, input.userId);

          if (error && error.code !== 'PGRST116') {
            console.warn(`⚠️ Failed to delete from ${table}:`, error);
          } else {
            console.log(`✅ Cleaned data from ${table}`);
          }
        } catch (tableError) {
          console.warn(`⚠️ Error cleaning table ${table}:`, tableError);
        }
      }

      const { error: deleteUserError } = await supabase.auth.admin.deleteUser(input.userId);

      if (deleteUserError) {
        console.error('❌ Failed to delete auth user:', deleteUserError);
        throw deleteUserError;
      }

      console.log('✅ Account deleted successfully');

      return {
        success: true,
        message: 'Account deleted successfully',
      };
    } catch (error: any) {
      console.error('❌ Delete account error:', error);

      return {
        success: false,
        message: error.message || 'Failed to delete account',
      };
    }
  });











