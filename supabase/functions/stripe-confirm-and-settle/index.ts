import Stripe from 'npm:stripe';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {corsForRequest} from '../_shared/cors.ts';
import {finishStripeCheckout} from '../_shared/checkout-stripe.ts';
Deno.serve(async req=>{
 const headers={...corsForRequest(req),'Content-Type':'application/json'};
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 try{
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const {data:auth,error}=await db.auth.getUser((req.headers.get('authorization')||'').replace(/^Bearer\s+/i,''));
  if(error||!auth.user)return respond({error:'Authentication required'},401);
  const body=await req.json();
  if(!body.paymentIntentId)return respond({error:'Payment intent required'},400);
  const stripe=new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
  const intent=await stripe.paymentIntents.retrieve(body.paymentIntentId);
  if(!intent.metadata?.checkoutOrderId)return respond({error:'Legacy payment needs separately approved reconciliation',code:'LEGACY_RECONCILIATION_REQUIRED'},409);
  if(intent.metadata.buyerId!==auth.user.id||(body.orderId&&body.orderId!==intent.metadata.checkoutOrderId))return respond({error:'Payment not found'},404);
  const order=await finishStripeCheckout(db,intent);
  return respond({success:true,orderId:order.id});
 }catch{return respond({success:false,error:'Verified Stripe settlement unavailable'},409);}
});
