const {test} = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const code = ts.transpileModule(fs.readFileSync('supabase/functions/_shared/guest-paystack.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const id='11111111-1111-1111-1111-111111111111';
const reference=`guest_paystack_${id}`;
function setup(status='success') {
 const checkout={provider:'paystack',session_id:reference,state:'reserved',expires_at:new Date(Date.now()-1000).toISOString()};
 const order={id,business_id:'owner',user_id:'buyer',guest_email:'test@example.com',total_amount:1040,currency:'NGN',items:[]};
 const state={calls:[],ledger:0,fulfilled:0,refunds:0,routes:[]};
 const transaction={id:123,reference,status,amount:104000,currency:'NGN',metadata:{guest_order_id:id}};
 const db={from(name){let patch;const chain={select(){return this},eq(){return this},order(){return this},update(value){patch=value;return this},single:async()=>({data:name==='orders'?order:checkout}),limit:async()=>({data:state.routes}),then(resolve){Object.assign(name==='orders'?order:checkout,patch||{});resolve({error:null})}};return chain;},auth:{admin:{getUserById:async()=>({data:{user:{user_metadata:{}}}})}},rpc:async(name)=>{if(name==='finish_guest_order')checkout.state='paid';else state.ledger++;return {error:null}}};
 const exports={};
 const fetch=async(url,options)=>{
  state.calls.push({url,body:options.body?JSON.parse(options.body):null});
  const data=url.includes('/verify/')?transaction:url.includes('/refund?')?[]:url.endsWith('/refund')?(state.refunds++,{id:9}):{authorization_url:'https://checkout.paystack.com/example'};
  return {ok:true,json:async()=>({status:true,data})};
 };
 vm.runInNewContext(code,{exports,Response,Date,fetch,Deno:{env:{get:key=>key==='PAYSTACK_SECRET_KEY'?'sk_test_example':undefined}},require:name=>name.includes('commerce-rules')?{toMinorUnits:value=>Math.round(value*100)}:{fulfillGuestSession:async(session,paid)=>{state.fulfilled++;checkout.state=paid?'paid':'released';return new Response('OK')}}});
 return {checkout,order,state,transaction,db,...exports};
}
test('NGN checkout charges the server total in kobo and stores Paystack routing first',async()=>{
 const x=setup();const result=await x.initializeGuestPaystack(x.db,x.order,'/tables/venue?venueId=owner');
 assert.equal(result.provider,'paystack');assert.equal(x.checkout.provider,'paystack');assert.equal(x.order.payment_provider,'paystack');
 const body=x.state.calls.at(-1).body;assert.equal(body.amount,104000);assert.equal(body.metadata.guest_order_id,id);assert.equal(x.order.platform_fee,40);
});
test('verified success confirms booking and finalizes owner ledger',async()=>{
 const x=setup();assert.equal((await x.reconcileGuestPaystack(x.db,reference)).status,200);assert.equal(x.checkout.state,'paid');assert.equal(x.state.ledger,1);
});
test('wrong amount, currency or reference never confirms payment',async()=>{
 for(const patch of [{amount:1000},{currency:'USD'},{reference:'forged'},{metadata:{guest_order_id:'wrong'}}]){
  const x=setup();Object.assign(x.transaction,patch);await assert.rejects(x.reconcileGuestPaystack(x.db,reference));assert.equal(x.state.fulfilled,0);assert.equal(x.state.ledger,0);
 }
});
test('an expired abandoned checkout releases its hold, while processing retains it',async()=>{
 const abandoned=setup('abandoned');await abandoned.reconcileGuestPaystack(abandoned.db,reference);assert.equal(abandoned.checkout.state,'released');
 const processing=setup('processing');await processing.reconcileGuestPaystack(processing.db,reference);assert.equal(processing.checkout.state,'reserved');
});
test('payment after a released hold is refunded rather than double-booked',async()=>{
 const x=setup();x.checkout.state='released';await x.reconcileGuestPaystack(x.db,reference);assert.equal(x.state.refunds,1);assert.equal(x.state.fulfilled,0);assert.equal(x.state.ledger,0);assert.equal(x.checkout.refund_id,'9');
 await x.reconcileGuestPaystack(x.db,reference);assert.equal(x.state.refunds,1);
});

test('legacy Nigerian subaccount metadata preserves seller splits and the platform fee',async()=>{
 const x=setup();x.state.routes=[{metadata:{business_bank_account:{paystackSubaccountCode:'ACCT_legacy'}}}];
 await x.initializeGuestPaystack(x.db,x.order,'/tables/venue');
 const payload=x.state.calls.at(-1).body;
 assert.equal(payload.subaccount,'ACCT_legacy');assert.equal(payload.transaction_charge,4000);assert.equal(payload.bearer,'account');
});
test('ledger failure leaves a paid checkout recoverable before any receipt is sent',async()=>{
 const x=setup();const original=x.db.rpc;
 x.db.rpc=async(name)=>name==='finalize_paystack_ledger'?{error:new Error('Ledger temporarily unavailable')}:original(name);
 await assert.rejects(x.reconcileGuestPaystack(x.db,reference),/Ledger temporarily unavailable/);
 assert.equal(x.checkout.state,'paid');assert.equal(x.state.fulfilled,0);
 x.db.rpc=original;await x.reconcileGuestPaystack(x.db,reference);
 assert.equal(x.state.fulfilled,1);assert.equal(x.state.ledger,1);
});
