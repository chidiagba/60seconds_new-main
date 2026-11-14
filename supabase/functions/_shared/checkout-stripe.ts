import { toMinorUnits } from '../../../utils/commerce-rules.ts';
export async function finishStripeCheckout(db: any, intent: any) {
  if (intent.status !== 'succeeded' || !intent.metadata?.checkoutOrderId) throw new Error('Verified checkout payment required');
  const {data: order,error: lookupError}=await db.from('orders').select('*').eq('id',intent.metadata.checkoutOrderId).single();
  if (lookupError || !order || order.user_id!==intent.metadata.buyerId || order.payment_provider!=='stripe'
      || order.payment_metadata?.checkout_version!=='voucher_v2'
      || intent.amount_received!==toMinorUnits(Number(order.total_amount),order.currency)
      || intent.currency!==order.currency.toLowerCase()) throw new Error('Stripe payment does not match checkout');
  const {error: bindError}=await db.rpc('bind_checkout_reference',{order_key:order.id,reference:intent.id});
  if(bindError)throw bindError;
  const {data,error}=await db.rpc('finalize_checkout_payment',{order_key:order.id,provider:'stripe',reference:intent.id,paid_amount:Number(order.total_amount),paid_currency:order.currency,transaction_key:intent.id});
  if(error)throw error;
  return data;
}
