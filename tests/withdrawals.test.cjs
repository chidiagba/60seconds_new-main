const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync('supabase/functions/_shared/withdrawals.ts','utf8');
function setup({balanceError=false,verified=true,providerStatus='pending',timeout=false,provider='paystack',stripeStatus='pending',reverseError=false}={}) {
 const events=[];let handler;
 const hold={reference:'wd_server',state:'pending',transaction_id:'tx',amount:60,currency:'NGN',provider,created_at:new Date().toISOString(),destination:{recipient:'RCP_saved',connected_account:'acct_saved',external_account:'ba_saved'},provider_data:{}};
 const db={auth:{getUser:async token=>({data:{user:token==='valid'?{id:'owner'}:null}})},rpc:async(name,args)=>{
  events.push({name,args});
  if(name==='reserve_withdrawal')return balanceError||!verified?{error:{message:'denied'}}:{data:hold};
  return {error:null};
 }};
 const exports={};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{
 exports,Request,Response,AbortSignal,Date,crypto:webcrypto,Deno:{env:{get:()=> 'test-config'}},
 require:name=>name.includes('supabase-js')?{createClient:()=>db}:name.includes('cors')?{corsForRequest:()=>({})}:name.includes('commerce-rules')?{currencyDigits:()=>2}:class {constructor(){this.transfers={create:async(body,opts)=>{events.push({name:'stripe_transfer',body,opts});return{id:'tr_saved',amount:6000,destination:'acct_saved',reversed:false};},createReversal:async()=>{events.push({name:'stripe_reversal'});if(reverseError)throw new Error('uncertain reversal');return{amount:6000};}};this.payouts={create:async(body,opts)=>{events.push({name:'stripe_payout',body,opts});return{id:'po_saved',amount:6000,destination:'ba_saved',status:stripeStatus};}};}},
 fetch:async(url,opts)=>{events.push({name:'provider',url,body:opts.body&&JSON.parse(opts.body)});if(timeout)throw new Error('timeout');return {ok:true,json:async()=>({status:true,data:{reference:'wd_server',amount:6000,currency:'NGN',recipient:{recipient_code:'RCP_saved'},status:providerStatus,transfer_code:'TRF_test'}})};},
 });
 handler=exports.withdrawalHandler(provider);
 const invoke=(body={},token='valid')=>handler(new Request('https://example.test',{method:'POST',headers:{authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({amount:60,businessBankAccountId:'11111111-1111-4111-8111-111111111111',idempotencyKey:'22222222-2222-4222-8222-222222222222',...body})}));
 return {invoke,events,hold,exports,db};
}
test('insufficient balance and unverified bank never call payout provider',async()=>{
 for(const options of [{balanceError:true},{verified:false}]) {const x=setup(options);assert.equal((await x.invoke()).status,409);assert.equal(x.events.filter(e=>e.name==='provider').length,0);}
});
test('payout reserves first and ignores client destination, currency and reference',async()=>{
 const x=setup();assert.equal((await x.invoke({reference:'forged',paystackRecipientCode:'RCP_attacker',currency:'USD',connectedAccountId:'acct_attacker'})).status,202);
 assert.equal(x.events[0].name,'reserve_withdrawal');const call=x.events.find(e=>e.name==='provider');assert.equal(call.body.reference,'wd_server');assert.equal(call.body.recipient,'RCP_saved');assert.equal(call.body.amount,6000);
});
test('timeout retains pending hold and returns same server reference',async()=>{
 const x=setup({timeout:true});const r=await x.invoke();assert.equal(r.status,202);assert.equal((await r.json()).reference,'wd_server');assert.equal(x.events.filter(e=>e.name==='finish_withdrawal').length,0);
});
test('replay verifies the original provider reference rather than sending another transfer',async()=>{
 const x=setup();x.hold.alreadyReserved=true;await x.invoke();const call=x.events.find(e=>e.name==='provider');assert.ok(call.url.includes('/transfer/verify/wd_server'));assert.equal(call.body,undefined);
});
test('only verified terminal transfer states complete or release holds',async()=>{
 for(const status of ['success','failed','reversed','pending']){
  const x=setup({providerStatus:status});await x.invoke();assert.equal(x.events.find(e=>e.name==='finish_withdrawal').args.p_state,status==='success'?'completed':status);
 }
});
test('missing session or saved destination returns proper HTTP error',async()=>{
 const x=setup();assert.equal((await x.invoke({},'invalid')).status,401);assert.equal((await x.invoke({businessBankAccountId:'meta_owner'})).status,400);assert.equal(x.events.length,0);
});
test('worker authentication rejects missing and altered secrets',async()=>{
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('supabase/functions/_shared/worker-auth.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,crypto:webcrypto,TextEncoder,Uint8Array});
 for(const token of ['','Bearer wrong','Bearer correct-extra']) assert.equal(await exports.workerAuthorized(new Request('https://example.test',{headers:{authorization:token}}),'correct'),false);
 assert.equal(await exports.workerAuthorized(new Request('https://example.test',{headers:{authorization:'Bearer correct'}}),'correct'),true);
});

test('Stripe reserves before transferring, uses saved destination and stable provider idempotency keys',async()=>{
 const x=setup({provider:'stripe'});assert.equal((await x.invoke({connectedAccountId:'acct_forged',stripeExternalAccountId:'ba_forged'})).status,202);
 assert.equal(x.events[0].name,'reserve_withdrawal');
 const transfer=x.events.find(e=>e.name==='stripe_transfer'),payout=x.events.find(e=>e.name==='stripe_payout');
 assert.equal(transfer.body.destination,'acct_saved');assert.equal(transfer.opts.idempotencyKey,'wd_server_transfer');
 assert.equal(payout.body.destination,'ba_saved');assert.equal(payout.opts.stripeAccount,'acct_saved');assert.equal(payout.opts.idempotencyKey,'wd_server_payout');
});
test('Stripe only releases after a failed payout has returned platform funds',async()=>{
 const x=setup({provider:'stripe',stripeStatus:'failed'});assert.equal((await x.invoke()).status,422);
 const reversal=x.events.findIndex(e=>e.name==='stripe_reversal'),release=x.events.findIndex(e=>e.name==='finish_withdrawal'&&e.args.p_state==='reversed');
 assert.ok(reversal>0&&release>reversal);
});
test('uncertain Stripe reversal keeps the wallet hold',async()=>{
 const x=setup({provider:'stripe',stripeStatus:'failed',reverseError:true});assert.equal((await x.invoke()).status,202);
 assert.equal(x.events.filter(e=>e.name==='finish_withdrawal'&&['failed','reversed'].includes(e.args.p_state)).length,0);
});
