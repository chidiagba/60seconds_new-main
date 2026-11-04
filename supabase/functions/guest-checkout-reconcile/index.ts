import { reconcileGuestPaystack } from '../_shared/guest-paystack.ts';
import Stripe from 'npm:stripe';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fulfillGuestSession } from '../_shared/guest-fulfillment.ts';
Deno.serve(async req => {
  const secret = Deno.env.get('GUEST_WORKER_SECRET');
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorized',{status:401});
  const input = await req.json().catch(()=>({}));
  if (input.action === 'health') return Response.json({stripe:Deno.env.get('STRIPE_SECRET_KEY')?.startsWith('sk_test_') ? 'test' : 'live',paystack:Deno.env.get('PAYSTACK_SECRET_KEY')?.startsWith('sk_test_') ? 'test' : 'live'});
  const db = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!,{maxNetworkRetries:2});
  const { data: jobs, error } = await db.from('guest_checkouts').select('*').is('email_sent_at',null).or('state.in.(reserved,paid),refund_pending.eq.true').lt('created_at',new Date(Date.now()-3600000).toISOString()).order('created_at').limit(20);
  if (error) return new Response('Queue unavailable',{status:500});
  let recovered = 0;
  for (const job of jobs || []) {
    try {
      if (job.provider === 'paystack') {
        if (job.session_id && (await reconcileGuestPaystack(db,job.session_id)).ok) recovered++;
        continue;
      }
      let session = job.session_id ? await stripe.checkout.sessions.retrieve(job.session_id) : null;
      if (!session) {
        const start = Math.floor(Date.parse(job.created_at)/1000)-60;
        for await (const candidate of stripe.checkout.sessions.list({created:{gte:start,lte:start+3660},limit:100})) {
          if (candidate.metadata?.guest_order_id === job.order_id) { session = candidate; break; }
        }
      }
      if (!session) {
        const { error } = await db.rpc('finish_guest_order',{order_key:job.order_id,paid:false,session_key:''});
        if (error) throw error;
        recovered++;
      } else if (session.status === 'expired' || session.payment_status === 'paid') {
        const result = await fulfillGuestSession(session,session.payment_status === 'paid');
        if (result.ok) recovered++;
      }
    } catch(error) { console.error('Guest order reconciliation failed',job.order_id,error); }
  }
  return Response.json({recovered});
});
