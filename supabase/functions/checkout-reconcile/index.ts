import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe';
import {corsForRequest} from '../_shared/cors.ts';
import {finishStripeCheckout} from '../_shared/checkout-stripe.ts';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
Deno.serve(async req=>{
 const headers={...corsForRequest(req),'Content-Type':'application/json'};
 const respond=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 try{
  const {data:auth,error:authError}=await db.auth.getUser((req.headers.get('authorization')||'').replace(/^Bearer\s+/i,''));
  if(authError||!auth.user)return respond({error:'Authentication required'},401);
  const body=await req.json();
  const {data:order,error}=await db.from('orders').select('*').eq('id',body.orderId).eq('user_id',auth.user.id).single();
  if(error||!order)return respond({error:'Order not found'},404);
  if(order.payment_metadata?.checkout_version!=='voucher_v2')return respond({error:'Historical order requires an evidence-based support audit'},409);
  if(order.payment_provider==='voucher'){
   const {data:completed,error:recoveryError}=await db.rpc('recover_zero_checkout_order',{order_key:order.id});
   if(recoveryError)throw recoveryError;return respond({success:true,order:completed});
  }
  if(order.payment_status==='paid')return respond({success:true,order});
  if(order.payment_provider==='stripe'){
   const stripe=new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
   if(!order.payment_reference?.startsWith('pi_'))return respond({error:'Payment initialization requires reconciliation'},409);
   let intent=await stripe.paymentIntents.retrieve(order.payment_reference);
   if(intent.metadata.checkoutOrderId!==order.id||intent.metadata.buyerId!==auth.user.id)throw new Error('Payment ownership mismatch');
   if(intent.status==='succeeded')return respond({success:true,order:await finishStripeCheckout(db,intent)});
   if(body.action==='cancel'&&intent.status!=='processing'&&intent.status!=='canceled')intent=await stripe.paymentIntents.cancel(intent.id,{}, {idempotencyKey:`cancel-${order.id}`});
   if(intent.status==='canceled'){
    const {error:releaseError}=await db.rpc('release_checkout_order',{order_key:order.id});if(releaseError)throw releaseError;
    return respond({success:false,cancelled:true});
   }
  }else if(order.payment_provider==='paystack'){
   const response=await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(order.payment_reference)}`,{headers:{Authorization:`Bearer ${Deno.env.get('PAYSTACK_SECRET_KEY')}`}});
   const payload=await response.json();if(!response.ok||payload.status!==true)throw new Error('Payment verification unavailable');
   const transaction=payload.data;
   if(transaction.status==='success'){
    const {data:completed,error:finalizeError}=await db.rpc('finalize_checkout_payment',{order_key:order.id,provider:'paystack',reference:transaction.reference,paid_amount:Number(transaction.amount)/100,paid_currency:transaction.currency,transaction_key:String(transaction.id)});
    if(finalizeError)throw finalizeError;return respond({success:true,order:completed});
   }
   if(transaction.status==='failed' && transaction.reference===order.payment_reference){
    const {error:releaseError}=await db.rpc('release_checkout_order',{order_key:order.id});if(releaseError)throw releaseError;
    return respond({success:false,cancelled:true});
   }
  }
  return respond({success:false,pending:true});
 }catch{return respond({error:'Unable to reconcile payment safely'},409);}
});
