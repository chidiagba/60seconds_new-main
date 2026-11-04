import Stripe from 'npm:stripe';
import { fulfillGuestSession } from '../_shared/guest-fulfillment.ts';
Deno.serve(async req => {
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
  let event: Stripe.Event;
  try { event = await stripe.webhooks.constructEventAsync(await req.text(),req.headers.get('stripe-signature') || '',Deno.env.get('STRIPE_GUEST_WEBHOOK_SECRET')!); }
  catch { return new Response('Invalid signature',{status:400}); }
  if (!['checkout.session.completed','checkout.session.expired'].includes(event.type)) return new Response('Ignored');
  const session = event.data.object as Stripe.Checkout.Session;
  const paid = session.payment_status === 'paid';
  if (!paid && event.type !== 'checkout.session.expired') return new Response('Pending');
  return fulfillGuestSession(session, paid);
});
