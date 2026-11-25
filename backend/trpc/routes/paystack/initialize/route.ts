import {TRPCError} from '@trpc/server';
import {z} from 'zod';
import {protectedProcedure} from '../../../create-context';
import {supabase} from '@/backend/lib/supabase';

const fundingResult=z.object({success:z.literal(true),data:z.object({authorization_url:z.string().url(),access_code:z.string(),reference:z.string()})});
export const initializePaymentProcedure=protectedProcedure.input(z.object({
 email:z.string().email(),amount:z.number().finite().min(100).max(10000000),currency:z.literal('NGN').default('NGN'),
 callback_url:z.string().url().optional(),metadata:z.record(z.unknown()).optional(),
 paymentType:z.enum(['order_payment','wallet_funding']).optional(),
 // Old caller fields are parsed for compatibility; provider routing is server controlled.
 reference:z.string().optional(),channels:z.array(z.string()).optional(),split_code:z.string().optional(),
 subaccount:z.string().optional(),transaction_charge:z.number().optional(),bearer:z.enum(['account','subaccount']).optional(),
 userId:z.string().optional(),orderId:z.string().optional(),walletId:z.string().optional(),
})).mutation(async({input,ctx})=>{
 const requestedType=input.paymentType||input.metadata?.paymentType;
 if(input.orderId||(requestedType&&requestedType!=='wallet_funding'))throw new TRPCError({code:'BAD_REQUEST',message:'Use server-priced order checkout'});
 // One authoritative funding initializer validates identity, wallet, callback and provider metadata.
 const {data,error}=await supabase.functions.invoke('paystack-initialize',{
  headers:{Authorization:ctx.req.headers.get('authorization')||''},
  body:{amount:input.amount,currency:input.currency,callback_url:input.callback_url,paymentType:'wallet_funding'},
 });
 if(error)throw new TRPCError({code:'BAD_REQUEST',message:'Wallet funding unavailable'});
 const parsed=fundingResult.safeParse(data);
 if(!parsed.success)throw new TRPCError({code:'BAD_GATEWAY',message:'Funding provider response unavailable'});
 return parsed.data;
});
