import { TRPCError } from '@trpc/server';
import { protectedProcedure } from '@/backend/trpc/create-context';
import { z } from 'zod';
// Welcome delivery follows verified signup in the authoritative Edge Function.
export const sendWelcomeEmailProcedure=protectedProcedure
  .input(z.object({email:z.string().email(),name:z.string().min(1)}))
  .mutation(()=>{throw new TRPCError({code:'NOT_FOUND',message:'Welcome delivery follows email verification'});});
