import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {finishStripeCheckout} from '../_shared/checkout-stripe.ts';
import Stripe from 'npm:stripe';
import { fulfillGuestSession } from '../_shared/guest-fulfillment.ts';
Deno.serve(async req => {
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
  let event: Stripe.Event;
  try { event = await stripe.webhooks.constructEventAsync(await req.text(),req.headers.get('stripe-signature') || '',Deno.env.get('STRIPE_GUEST_WEBHOOK_SECRET')!); }
  catch { return new Response('Invalid signature',{status:400}); }
  if (event.type.startsWith('payment_intent.')) {
    const intent=event.data.object as Stripe.PaymentIntent;
    if(!intent.metadata?.checkoutOrderId)return new Response('Ignored');
    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    try{
      if(event.type==='payment_intent.succeeded')await finishStripeCheckout(db,intent);
      if(event.type==='payment_intent.canceled'){
        const {data:order}=await db.from('orders').select('user_id,payment_reference').eq('id',intent.metadata.checkoutOrderId).single();
        if(!order||order.user_id!==intent.metadata.buyerId||order.payment_reference!==intent.id)throw new Error('Order mismatch');
        const {error}=await db.rpc('release_checkout_order',{order_key:intent.metadata.checkoutOrderId});if(error)throw error;
      }
      return new Response('Processed');
    }catch{return new Response('Fulfillment requires retry',{status:500});}
  }
  if (!['checkout.session.completed','checkout.session.expired'].includes(event.type)) return new Response('Ignored');
  const session = event.data.object as Stripe.Checkout.Session;
  const paid = session.payment_status === 'paid';
  if (!paid && event.type !== 'checkout.session.expired') return new Response('Pending');
  return fulfillGuestSession(session, paid);
});
