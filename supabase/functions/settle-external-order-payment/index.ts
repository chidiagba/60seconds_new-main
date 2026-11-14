import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {corsForRequest} from '../_shared/cors.ts';
import {verifyPaystackPayment} from '../_shared/paystack-verification.ts';
Deno.serve(async req=>{
 const headers={...corsForRequest(req),'Content-Type':'application/json'};
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 try{
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const {data:auth,error:authError}=await db.auth.getUser((req.headers.get('authorization')||'').replace(/^Bearer\s+/i,''));
  if(authError||!auth.user)return respond({error:'Authentication required'},401);
  const body=await req.json();
  const {data:order,error}=await db.from('orders').select('*').eq('id',body.orderId).eq('user_id',auth.user.id).single();
  if(error||!order)return respond({error:'Order not found'},404);
  if(order.payment_metadata?.checkout_version!=='voucher_v2')return respond({error:'Legacy payment needs separately approved reconciliation',code:'LEGACY_RECONCILIATION_REQUIRED'},409);
  if(body.provider!=='paystack'||order.payment_provider!=='paystack')return respond({error:'Use the verified checkout handler for this provider'},426);
  if(body.paymentReference&&body.paymentReference!==order.payment_reference)return respond({error:'Payment reference mismatch'},409);
  const transaction=await verifyPaystackPayment(order.payment_reference,Deno.env.get('PAYSTACK_SECRET_KEY')||'');
  const {data:completed,error:finalizeError}=await db.rpc('finalize_checkout_payment',{order_key:order.id,provider:'paystack',reference:transaction.reference,paid_amount:Number(transaction.amount)/100,paid_currency:transaction.currency,transaction_key:String(transaction.id)});
  if(finalizeError)throw finalizeError;
  return respond({success:true,orderId:completed.id});
 }catch{return respond({success:false,error:'Verified settlement unavailable; no payment success was established'},409);}
});
