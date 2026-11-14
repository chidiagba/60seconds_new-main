import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {corsForRequest} from '../_shared/cors.ts';
import {verifyPaystackPayment} from '../_shared/paystack-verification.ts';
Deno.serve(async req=>{
 const headers={...corsForRequest(req),'Content-Type':'application/json'};
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 try{
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const {data:auth,error}=await db.auth.getUser((req.headers.get('authorization')||'').replace(/^Bearer\s+/i,''));
  if(error||!auth.user)return respond({success:false,error:'Authentication required'},401);
  const {reference}=await req.json();
  const transaction=await verifyPaystackPayment(String(reference||''),Deno.env.get('PAYSTACK_SECRET_KEY')||'');
  const metadata=transaction.metadata||{};
  let owns=metadata.userId===auth.user.id||metadata.buyerId===auth.user.id||metadata.user_id===auth.user.id;
  if(!owns){const {data:order}=await db.from('orders').select('id').eq('payment_reference',reference).eq('user_id',auth.user.id).maybeSingle();owns=!!order;}
  if(!owns)return respond({success:false,error:'Payment not found'},404);
  // Card authorization tokens and another customer's details never leave here.
  return respond({success:true,data:{id:transaction.id,reference:transaction.reference,status:'success',amount:transaction.amount,currency:transaction.currency,paid_at:transaction.paid_at}});
 }catch{return respond({success:false,error:'Payment verification unavailable. No payment success was established.',code:'PAYMENT_VERIFICATION_UNAVAILABLE'},502);}
});
