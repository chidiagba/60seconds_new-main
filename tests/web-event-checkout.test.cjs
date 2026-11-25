const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
function load(file,req=()=>({}),globals={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,{exports,require:req,Date,Map,Response,console,...globals});return exports;}
const methods=load('utils/web-payment-methods.ts');
const key='40000000-0000-4000-8000-000000000001';const eventId='10000000-0000-0000-0000-000000000001';const productId='20000000-0000-0000-0000-000000000001';const tableId='30000000-0000-0000-0000-000000000001';
function fixture(){
 const order={id:'50000000-0000-4000-8000-000000000001',business_id:'owner',guest_email:'buyer@example.com',currency:'NGN',total_amount:3120,items:[{name:'Entry',price:1040,quantity:1},{name:'Table',price:2080,quantity:1}]};
 const state={rpc:[],updates:[],paystack:[],stripe:[],connected:null,fresh:true,url:null,status:'reserved',provider:'stripe',session:null};
 const checkout={state:'reserved',provider:'stripe',session_id:null,expires_at:new Date(Date.now()+1800000).toISOString()};
 const db={rpc:async(name,args)=>{state.rpc.push({name,args});return {data:{order,fresh:state.fresh,url:state.url,state:state.status,expiresAt:checkout.expires_at}};},from(name){const chain={select(){return this;},eq(){return this;},update(patch){state.updates.push({name,patch});if(name==='guest_checkouts')Object.assign(checkout,patch);return this;},maybeSingle:async()=>({data:name==='profiles'?(state.connected?{stripe_connected_account_id:state.connected}:{}):{order_id:order.id,event_id:eventId,checkout_url:state.url}}),single:async()=>({data:checkout}),then(resolve){resolve({error:null});}};return chain;}};
 class Stripe{constructor(){this.accounts={retrieve:async()=>({charges_enabled:true,payouts_enabled:true})};this.checkout={sessions:{create:async(params,options)=>{state.stripe.push({params,options});return {id:'cs_test_checkout',url:'https://checkout.stripe.com/c/pay/example',expires_at:Math.floor(Date.now()/1000)+1860};},retrieve:async()=>state.session}};}}
 const mod=load('supabase/functions/_shared/web-event-checkout.ts',name=>name.startsWith('npm:stripe')?Stripe:name.includes('web-payment-methods')?methods:name.includes('commerce-rules')?{toMinorUnits:amount=>Math.round(amount*100)}:name.includes('guest-paystack')?{initializeGuestPaystack:async(db,order,path,channel)=>{state.paystack.push({order,path,channel});return {provider:'paystack',url:'https://checkout.paystack.com/example'};},reconcileGuestPaystack:async()=>{checkout.state='paid';}}:{fulfillGuestSession:async(session,paid)=>{checkout.state=paid?'paid':'released';return new Response('OK');}}, {Deno:{env:{get:name=>name==='PUBLIC_EVENT_BASE_URL'?'https://events.60secondsapp.io':'test-server-secret'}}});
 const input={email:'buyer@example.com',buyerRegion:'NG',paymentMethod:'paystack_card',requestKey:key,items:[{id:productId,quantity:1,price:1}],tables:[{id:tableId,quantity:1}]};
 return {...mod,db,state,order,input,checkout,event:{id:eventId,currency:'NGN'}};
}
test('Nigeria offers Paystack card/transfer; other countries use Stripe without changing NGN prices',()=>{
 assert.deepEqual(Array.from(methods.webPaymentOptions('NG','NGN'),x=>x.id),['paystack_card','paystack_transfer']);
 assert.equal(methods.webPaymentOptions('OTHER','NGN')[0].id,'stripe_card');
 assert.equal(methods.webPaymentOptions('NG','CHF')[0].id,'stripe_card');
 assert.throws(()=>methods.webPaymentRoute('OTHER','NGN','paystack_card'));
 assert.throws(()=>methods.webPaymentRoute('NG','NGN','stripe_card'));
});
test('selected Paystack channel is enforced for mixed ticket/table purchases',async()=>{
 for(const [method,channel] of [['paystack_card','card'],['paystack_transfer','bank_transfer']]){
  const x=fixture();x.input.paymentMethod=method;
  const result=await x.createWebEventCheckout(x.db,x.event,x.input);
  assert.equal(result.status,200);assert.equal(x.state.paystack[0].channel,channel);
  assert.match(x.state.paystack[0].path,new RegExp(`attempt=${key}`));
  assert.equal(x.state.rpc[0].args.requested_items[0].price,undefined);
  assert.equal(x.state.rpc[0].args.payment_method,method);
 }
});
test('non-Nigerian buyer uses hosted Stripe card with server-priced mixed items',async()=>{
 const x=fixture();Object.assign(x.input,{buyerRegion:'OTHER',paymentMethod:'stripe_card'});
 const result=await x.createWebEventCheckout(x.db,x.event,x.input);
 assert.equal(result.status,200);const payload=x.state.stripe[0].params;
 assert.equal(payload.allowed_payment_method_types[0],'card');assert.equal(payload.payment_method_types,undefined);assert.equal(payload.line_items[0].price_data.currency,'ngn');
 assert.equal(payload.line_items[0].price_data.unit_amount,104000);assert.equal(payload.line_items[1].price_data.unit_amount,208000);
 assert.equal(payload.metadata.guest_order_id,x.order.id);assert.match(payload.success_url,/payment=processing/);
 assert.equal(payload.payment_intent_data,undefined);assert.equal(x.state.stripe[0].options.idempotencyKey,`web-guest-${x.order.id}`);
 assert.ok(payload.expires_at >= Math.floor(Date.now()/1000)+1800);
 assert.equal(x.checkout.provider,'stripe');assert.equal(x.checkout.session_id,'cs_test_checkout');
});
test('connected Stripe sellers preserve destination and platform fee routing',async()=>{
 const x=fixture();x.state.connected='acct_connected';Object.assign(x.input,{buyerRegion:'OTHER',paymentMethod:'stripe_card'});
 await x.createWebEventCheckout(x.db,x.event,x.input);
 assert.equal(x.state.stripe[0].params.payment_intent_data.transfer_data.destination,'acct_connected');
 assert.equal(x.state.stripe[0].params.payment_intent_data.application_fee_amount,12000);
});
test('invalid methods, region, attempt tokens, and empty baskets never reserve inventory',async()=>{
 for(const patch of [{buyerRegion:'invalid'},{buyerRegion:'OTHER'},{requestKey:'guessable'},{email:'not-email'},{items:[],tables:[]}]){
  const x=fixture();Object.assign(x.input,patch);const result=await x.createWebEventCheckout(x.db,x.event,x.input);
  assert.equal(result.status,400);assert.equal(result.body.reserved,false);assert.equal(x.state.rpc.length,0);
 }
});
test('cached same-attempt retry resumes one provider URL and cannot initialize again',async()=>{
 const x=fixture();x.state.fresh=false;x.state.url='https://checkout.paystack.com/existing';
 const result=await x.createWebEventCheckout(x.db,x.event,x.input);assert.equal(result.body.url,x.state.url);assert.equal(x.state.paystack.length,0);
 x.state.url=null;assert.equal((await x.createWebEventCheckout(x.db,x.event,x.input)).status,409);assert.equal(x.state.paystack.length,0);
});
test('browser status is not paid until the stored provider session is verified',async()=>{
 const x=fixture();x.checkout.session_id='cs_test_checkout';x.state.session={id:'cs_test_checkout',metadata:{guest_order_id:x.order.id},status:'open',payment_status:'unpaid'};
 assert.equal((await x.webEventCheckoutStatus(x.db,eventId,key)).body.state,'reserved');
 x.state.session.payment_status='paid';assert.equal((await x.webEventCheckoutStatus(x.db,eventId,key)).body.state,'paid');
});
test('status lookup rejects another event or an invalid bearer attempt',async()=>{
 const x=fixture();assert.equal((await x.webEventCheckoutStatus(x.db,'other-event',key)).status,404);
 assert.equal((await x.webEventCheckoutStatus(x.db,eventId,'invalid')).status,400);
});
test('basket normalization rejects client quantity manipulation and aggregates duplicates',()=>{
 const rows=methods.webCheckoutItems([{id:productId,quantity:1,price:0},{id:productId,quantity:2}],30);
 assert.equal(rows.length,1);assert.equal(rows[0].quantity,3);assert.equal(rows[0].price,undefined);
 for(const quantity of [-1,0,1.5,NaN,501,'1'])assert.throws(()=>methods.webCheckoutItems([{id:productId,quantity}],30));
});
