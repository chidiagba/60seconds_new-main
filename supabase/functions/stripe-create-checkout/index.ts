import Stripe from 'npm:stripe';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {corsForRequest} from '../_shared/cors.ts';
import {toMinorUnits} from '../../../utils/commerce-rules.ts';
Deno.serve(async req=>{
 const headers={...corsForRequest(req),'Content-Type':'application/json'};
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 try{
  const body=await req.json();
  if(!Array.isArray(body.items))return respond({error:'Client-priced checkout is retired. Update the app.',code:'CHECKOUT_UPGRADE_REQUIRED'},426);
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const {data:auth,error:authError}=await db.auth.getUser((req.headers.get('authorization')||'').replace(/^Bearer\s+/i,''));
  if(authError||!auth.user)return respond({error:'Authentication required'},401);
  if(body.voucherId&&!body.voucherCode)return respond({error:'Validate the selected voucher again'},409);
  const {data:order,error}=await db.rpc('create_order_checkout',{requested_items:body.items,voucher_code:body.voucherCode||null,request_key:body.requestKey,provider:'stripe',buyer_key:auth.user.id});
  if(error||!order)return respond({error:error?.message||'Checkout unavailable'},409);
  if(body.voucherId&&body.voucherId!==order.voucher_id)return respond({error:'Selected voucher mismatch'},409);
  if(order.payment_status==='paid')return respond({completed:true,order});
  const stripe=new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
  const {data:owner}=await db.from('profiles').select('stripe_connected_account_id').eq('id',order.business_id).maybeSingle();
  const customer=await stripe.customers.create({email:auth.user.email},{idempotencyKey:`checkout-customer-${order.id}`});
  const ephemeral=await stripe.ephemeralKeys.create({customer:customer.id},{apiVersion:'2023-10-16'});
  const params:any={amount:toMinorUnits(Number(order.total_amount),order.currency),currency:order.currency.toLowerCase(),customer:customer.id,automatic_payment_methods:{enabled:true},metadata:{checkoutOrderId:order.id,buyerId:auth.user.id,ownerId:order.business_id}};
  if(owner?.stripe_connected_account_id){params.transfer_data={destination:owner.stripe_connected_account_id};params.application_fee_amount=toMinorUnits(Number(order.platform_fee),order.currency);}
  const intent=await stripe.paymentIntents.create(params,{idempotencyKey:`checkout-intent-${order.id}`});
  const {error:bindError}=await db.rpc('bind_checkout_reference',{order_key:order.id,reference:intent.id});
  if(bindError)throw bindError;
  return respond({orderId:order.id,paymentIntentClientSecret:intent.client_secret,customerId:customer.id,ephemeralKeySecret:ephemeral.secret,totalAmount:intent.amount});
 }catch{return respond({error:'Unable to initialize checkout safely'},409);}
});
