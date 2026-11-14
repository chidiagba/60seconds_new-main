import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { supabase } from '../lib/supabase';

export const createContext = async (opts: FetchCreateContextFnOptions) => {
  const authorization = opts.req.headers.get('authorization');
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const { data, error } = token
    ? await supabase.auth.getUser(token)
    : { data: { user: null }, error: null };
  return { req: opts.req, user: error ? null : data.user };
};
export type Context = Awaited<ReturnType<typeof createContext>>;
const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape }) {
    if (shape.data.code === 'INTERNAL_SERVER_ERROR') {
      return { ...shape, message: 'Request could not be completed', data: { code: shape.data.code, httpStatus: 500 } };
    }
    return { ...shape, data: { ...shape.data, stack: undefined } };
  },
});
export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in required' });
  return next({ ctx: { ...ctx, user: ctx.user } });
});
export const disabledProcedure = t.procedure.use(() => {
  throw new TRPCError({ code: 'NOT_FOUND', message: 'Payment provider is disabled' });
});
