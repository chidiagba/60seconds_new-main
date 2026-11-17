const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, requireModule, globals={}) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,
    {exports,require:requireModule,console,Response,Request,...globals});
  return exports;
}
test('Paystack free checkout returns fulfilled order without a provider key or network call',async()=>{
  let handler, calls=0;
  const order={id:'free',payment_status:'paid',payment_reference:'VOUCHER-free'};
  const client={auth:{getUser:async()=>({data:{user:{id:'buyer'}}})},rpc:async(name,args)=>{
    assert.equal(name,'create_order_checkout'); assert.equal(args.buyer_key,'buyer');
    return {data:order};
  }};
  load('supabase/functions/paystack-create-order-checkout/index.ts',name=>{
    if(name.includes('supabase-js'))return {createClient:()=>client};
    if(name.includes('cors'))return {corsForRequest:()=>({})};
    if(name.includes('logger'))return {logger:{debug(){}}};
    return {};
  },{Deno:{env:{get:()=>''},serve:fn=>{handler=fn;}},crypto:{randomUUID:()=> 'server-key'},fetch:()=>{calls++;throw Error('Gateway must not be called');}});
  const response=await handler(new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer user'},body:JSON.stringify({items:[{productId:'ticket',quantity:1}],voucherCode:'FREE'})}));
  assert.equal(response.status,200);assert.equal((await response.json()).completed,true);assert.equal(calls,0);
});
function stripeFixture(overrides={}){
  const calls=[];
  const order={id:'order',user_id:'buyer',payment_provider:'stripe',total_amount:520,currency:'NGN',payment_metadata:{checkout_version:'voucher_v2'},...overrides};
  const db={from:()=>({select:()=>({eq:()=>({single:async()=>({data:order})})})}),rpc:async(name,args)=>{calls.push([name,args]);return {data:{...order,payment_status:'paid'}};}};
  const {finishStripeCheckout}=load('supabase/functions/_shared/checkout-stripe.ts',()=>({toMinorUnits:(n)=>Math.round(n*100)}));
  const intent={id:'pi_verified',status:'succeeded',amount_received:52000,currency:'ngn',metadata:{checkoutOrderId:'order',buyerId:'buyer'}};
  return {calls,db,intent,finishStripeCheckout};
}
test('Stripe finalizes only a verified matching payment using the stored order total',async()=>{
  const f=stripeFixture();await f.finishStripeCheckout(f.db,f.intent);
  assert.deepEqual(f.calls.map(c=>c[0]),['bind_checkout_reference','finalize_checkout_payment']);
  assert.equal(f.calls[1][1].paid_amount,520);
});
test('Stripe rejects wrong amount, currency, buyer and unconfirmed payments before fulfillment',async()=>{
  for(const change of [{amount_received:100},{currency:'usd'},{status:'processing'},{metadata:{checkoutOrderId:'order',buyerId:'attacker'}}]){
    const f=stripeFixture();await assert.rejects(()=>f.finishStripeCheckout(f.db,{...f.intent,...change}));assert.equal(f.calls.length,0);
  }
});
test('Stripe settlement failures propagate so webhook delivery retries',async()=>{
  const f=stripeFixture();f.db.rpc=async()=>({error:new Error('database unavailable')});
  await assert.rejects(()=>f.finishStripeCheckout(f.db,f.intent),/database unavailable/);
});
test('Paystack HTTP 403 and malformed success cannot reach payment settlement',async()=>{
 const {verifyPaystackPayment}=load('supabase/functions/_shared/paystack-verification.ts',()=>({}));
 for(const response of [
  {ok:false,status:403,json:async()=>({status:true,data:{status:'success'}})},
  {ok:true,status:200,json:async()=>({status:403,data:{status:'success'}})},
  {ok:true,status:200,json:async()=>({status:true,data:{id:1,status:'abandoned',reference:'ref',amount:100,currency:'NGN'}})},
  {ok:true,status:200,json:async()=>({status:true,data:{id:1,status:'success',reference:'other',amount:100,currency:'NGN'}})},
 ])await assert.rejects(()=>verifyPaystackPayment('ref','fake',async()=>response));
});
test('retired client-priced Stripe endpoints reject before contacting providers or database',async()=>{
 for(const file of ['stripe-create-checkout','stripe-create-payment-sheet']){
  let handler;
  load(`supabase/functions/${file}/index.ts`,name=>{
   if(name.includes('cors'))return {corsForRequest:()=>({})};
   if(name.includes('supabase-js'))return {createClient:()=>{throw Error('Database must not be called');}};
   if(name.includes('stripe'))return {default:class {constructor(){throw Error('Provider must not be called');}}};
   return {};
  },{Deno:{env:{get:()=>''},serve:fn=>handler=fn}});
  const response=await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify({amount:100,items:undefined})}));
  assert.equal(response.status,426);
 }
});
test('legacy settlement and Paystack verification denial never call the database finalizer',async()=>{
 for(const canonical of [false,true]){
  let handler,finalizations=0,verifications=0;
  const order={id:'order',payment_provider:'paystack',payment_reference:'stored-reference',payment_metadata:canonical?{checkout_version:'voucher_v2'}:{}};
  const builder={select(){return this;},eq(){return this;},single:async()=>({data:order})};
  const db={auth:{getUser:async()=>({data:{user:{id:'buyer'}}})},from:()=>builder,rpc:async()=>{finalizations++;throw Error('Finalizer must not be called');}};
  load('supabase/functions/settle-external-order-payment/index.ts',name=>{
   if(name.includes('supabase-js'))return {createClient:()=>db};
   if(name.includes('cors'))return {corsForRequest:()=>({})};
   if(name.includes('paystack-verification'))return {verifyPaystackPayment:async()=>{verifications++;throw Error('Paystack HTTP 403');}};
   return {};
  },{Deno:{env:{get:()=>''},serve:fn=>handler=fn}});
  const response=await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify({orderId:'order',provider:'paystack'})}));
  assert.equal(response.status,409);assert.equal(finalizations,0);assert.equal(verifications,canonical?1:0);
 }
});
test('a signed legacy Paystack webhook requests reconciliation without issuing receipts or acknowledging settlement',async()=>{
 let handler,writes=0;
 const crypto=require('node:crypto').webcrypto,key='fixture-webhook-key';
 const payload=JSON.stringify({event:'charge.success',data:{id:7,reference:'legacy-ref',amount:104000,currency:'NGN',metadata:{orderId:'legacy-order'}}});
 const signature=require('node:crypto').createHmac('sha512',key).update(payload).digest('hex');
 const db={from:table=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null}),single:async()=>({data:{id:'legacy-order',payment_metadata:{}}})}),rpc:async()=>{writes++;throw Error('No legacy financial writes');}};
 load('supabase/functions/paystack-webhook-settlement/index.ts',name=>{
  if(name.includes('supabase-js'))return {createClient:()=>db};
  if(name.includes('cors'))return {corsForRequest:()=>({})};
  if(name.includes('logger'))return {logger:{}};
  return {};
 },{crypto,TextEncoder,Deno:{env:{get:name=>name==='PAYSTACK_SECRET_KEY'?key:'fixture'},serve:fn=>handler=fn}});
 const response=await handler(new Request('https://example.test',{method:'POST',headers:{'x-paystack-signature':signature},body:payload}));
 assert.equal(response.status,503);assert.equal((await response.json()).success,false);assert.equal(writes,0);
});

function selectedPaystackFixture(cachedMetadata = null) {
 let handler; const initialized=[]; const stored=[];
 const order={id:'selected-order',order_number:'TEST',payment_status:'pending',payment_reference:'selected-reference',business_id:'owner',currency:'NGN',total_amount:1040,platform_fee:40,items:[{product_id:'ticket',quantity:1}]};
 const client={auth:{getUser:async()=>({data:{user:{id:'buyer',email:'buyer@example.test'}}}),admin:{getUserById:async()=>({data:{user:{user_metadata:{}}}})}},rpc:async()=>({data:order}),from(name){
  const chain={select(){return this;},eq(){return this;},order(){return this;},limit:async()=>({data:[]}),maybeSingle:async()=>({data:cachedMetadata?{metadata:cachedMetadata}:null}),upsert:async data=>{stored.push(data);return {error:null};},update(data){stored.push(data);return this;},then(resolve){resolve({error:null});}};
  return chain;
 }};
 load('supabase/functions/paystack-create-order-checkout/index.ts',name=>{
  if(name.includes('supabase-js'))return {createClient:()=>client};
  if(name.includes('cors'))return {corsForRequest:()=>({})};
  if(name.includes('logger'))return {logger:{debug(){}}};
  return {};
 },{Deno:{env:{get:name=>name==='PAYSTACK_SECRET_KEY'?'fixture-secret':'fixture'},serve:fn=>{handler=fn;}},crypto:{randomUUID:()=> 'fixture-key'},fetch:async(_url,options)=>{initialized.push(JSON.parse(options.body));return new Response(JSON.stringify({status:true,data:{authorization_url:'https://checkout.paystack.com/fixture',access_code:'fixture-code'}}),{status:200});}});
 return {initialized,stored,request:channels=>handler(new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer user'},body:JSON.stringify({items:[{productId:'ticket',quantity:1}],requestKey:'selected-method-attempt',channels})}))};
}
test('selected Paystack card and bank-transfer channels reach the actual initializer and durable attempt metadata',async()=>{
 for(const channel of ['card','bank_transfer']){
  const f=selectedPaystackFixture();const response=await f.request([channel]);
  assert.equal(response.status,200);assert.equal(f.initialized.length,1);
  assert.deepEqual(f.initialized[0].channels,[channel]);
  assert.equal(f.initialized[0].amount,104000);
  assert.deepEqual(Array.from(f.stored.at(-1).metadata.checkout_channels),[channel]);
 }
});
test('Paystack retries reuse a matching channel but never silently open an old different-method URL',async()=>{
 const cached={authorization_url:'https://checkout.paystack.com/fixture',access_code:'fixture',checkout_channels:['card']};
 const same=selectedPaystackFixture(cached);assert.equal((await same.request(['card'])).status,200);assert.equal(same.initialized.length,0);
 for(const metadata of [cached,{authorization_url:cached.authorization_url}]){
  const different=selectedPaystackFixture(metadata);const response=await different.request(['bank_transfer']);
  assert.equal(response.status,409);assert.match((await response.json()).error,/different payment method/);assert.equal(different.initialized.length,0);
 }
});
test('invalid Paystack channels cannot initialize a charge',async()=>{
 const f=selectedPaystackFixture();assert.equal((await f.request(['untrusted_method'])).status,400);assert.equal(f.initialized.length,0);
});

test('Stripe honors selected card mode and resumes the stored intent instead of creating a second payment',async()=>{
 for(const storedReference of [null,'pi_existing']){
  let handler,created=0,retrieved=0,params;
  const intent={id:'pi_existing',client_secret:'fixture-secret',amount:104000,currency:'ngn',status:'requires_payment_method',metadata:{checkoutOrderId:'stripe-order',buyerId:'buyer'}};
  const db={auth:{getUser:async()=>({data:{user:{id:'buyer',email:'buyer@example.test'}}})},rpc:async name=>({data:name==='create_order_checkout'?{id:'stripe-order',business_id:'owner',payment_status:'pending',payment_reference:storedReference,total_amount:1040,platform_fee:40,currency:'NGN'}:null}),from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null})})};
  class Stripe {customers={create:async()=>({id:'fixture-customer'})};ephemeralKeys={create:async()=>({secret:'fixture-ephemeral'})};paymentIntents={create:async value=>{created++;params=value;return intent;},retrieve:async()=>{retrieved++;return intent;}};}
  load('supabase/functions/stripe-create-checkout/index.ts',name=>{
   if(name.includes('supabase-js'))return {createClient:()=>db};
   if(name.includes('cors'))return {corsForRequest:()=>({})};
   if(name.includes('commerce-rules'))return {toMinorUnits:value=>Math.round(value*100)};
   if(name.includes('checkout-stripe'))return {finishStripeCheckout:()=>{throw Error('Unpaid intent must not settle');}};
   if(name==='npm:stripe')return {default:Stripe};
   throw Error(name);
  },{Deno:{env:{get:()=> 'fixture'},serve:fn=>{handler=fn;}}});
  const response=await handler(new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer user'},body:JSON.stringify({items:[{productId:'ticket',quantity:1}],requestKey:'stripe-selected-method',paymentMethod:'card'})}));
  assert.equal(response.status,200);assert.equal((await response.json()).paymentIntentClientSecret,'fixture-secret');
  assert.equal(created,storedReference?0:1);assert.equal(retrieved,storedReference?1:0);
  if(!storedReference){assert.deepEqual(Array.from(params.payment_method_types),['card']);assert.equal(params.automatic_payment_methods,undefined);}
 }
});
