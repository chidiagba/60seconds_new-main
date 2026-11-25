/** Isolated audit: actual handlers with fake identities/providers. Never performs network I/O.
 * PASS/FAIL here means the expected production-readiness behavior, not test runner success.
 */
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {webcrypto}=require('node:crypto');
const out='build/production-readiness-20261122';
const results=[];
function load(file,deps={},env={},extra={}){
 const exports={};let handler;
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,Request,Response,URL,AbortSignal,TextEncoder,Uint8Array,crypto:webcrypto,Date,console:{error(){},warn(){},log(){}},Deno:{env:{get:key=>env[key]},serve:fn=>handler=fn},require:name=>{if(name in deps)return deps[name];if(name.includes('edge-runtime'))return{};throw new Error('Unmocked dependency '+name);},...extra});
 return {exports,handler};
}
function record(name,expected,actual){results.push({name,status:JSON.stringify(expected)===JSON.stringify(actual)?'PASS':'FAIL',expected,actual});}
async function paystackStatuses(){
 for(const status of ['success','failed','reversed','pending','abandoned','blocked','rejected']){
  let persisted;
  const db={rpc:async(_name,args)=>{persisted=args.p_state;return{error:null};}};
  const m=load('supabase/functions/_shared/withdrawals.ts',{
   'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>db},'npm:stripe':class{},'./cors.ts':{corsForRequest:()=>({})},'../../../utils/commerce-rules.ts':{currencyDigits:()=>2},
  },{PAYSTACK_SECRET_KEY:'fake-test-key'},{fetch:async()=>({ok:true,json:async()=>({status:true,data:{reference:'wd_audit',amount:6000,currency:'NGN',recipient:{recipient_code:'RCP_test'},status}})})});
  await m.exports.processWithdrawal(db,{state:'pending',provider:'paystack',amount:60,currency:'NGN',reference:'wd_audit',destination:{recipient:'RCP_test'}},false);
  record('Paystack verified status '+status,status==='success'?'completed':['failed','reversed','abandoned','blocked','rejected'].includes(status)?status==='reversed'?'reversed':'failed':'pending',persisted);
 }
}
async function actualFundingCallback(){
 const db={auth:{getUser:async()=>({data:{user:{id:'audit-owner',email:'test@example.invalid'}}})},from:()=>({select(){return this},eq(){return this},single:async()=>({data:{id:'wallet',currency:'NGN'}})})};
 const m=load('supabase/functions/paystack-initialize/index.ts',{'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>db},'../_shared/cors.ts':{corsForRequest:()=>({})}},{SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'fake',PAYSTACK_SECRET_KEY:'fake',ALLOWED_ORIGINS:'https://60secondsapp.io'},{fetch:async()=>{throw new Error('Network blocked by audit');}});
 const r=await m.handler(new Request('https://api.invalid',{method:'POST',headers:{Authorization:'Bearer fake-session'},body:JSON.stringify({amount:100,currency:'NGN',callback_url:'myapp://paystack/callback',metadata:{type:'wallet_funding'}})}));
 record('Actual PaystackWebView funding callback accepted',200,r.status);
}
async function welcomeRejectedRetry(){
 let claimed=false,sends=0;
 const user={id:'audit-user',email:'noncustomer@example.invalid',app_metadata:{signup_otp_verified_at:new Date().toISOString()}};
 const db={auth:{getUser:async()=>({data:{user}})},from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{welcome_email_sent_at:null}})}),rpc:async()=>{const acquired=!claimed;claimed=true;return{data:acquired,error:null};}};
 const m=load('supabase/functions/send-welcome-email/index.ts',{'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>db},'../_shared/cors.ts':{corsForRequest:()=>({})},'../_shared/worker-auth.ts':{workerAuthorized:async()=>false},'../_shared/rate-limit.ts':{allowRequest:async()=>true}},{SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'fake',SENDGRID_API_KEY:'fake',POSTMARK_API_KEY:'fake',RESEND_API_KEY:'fake'},{fetch:async()=>{sends++;return{ok:false,status:403,text:async()=> 'explicit test rejection'};}});
 const request=()=>new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer fake-session'},body:'{}'});
 const first=await m.handler(request());const count=sends;const second=await m.handler(request());
 record('Explicit welcome provider rejection remains retryable',true,sends>count);
 results.push({name:'Welcome rejection reproduction',first_status:first.status,retry_status:second.status,retry_body:await second.json(),provider_stub_calls:sends,network_calls:0});
}
async function privateSignup(){
 let created;
 const db={from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:null})}),auth:{admin:{createUser:async input=>{created=input;return{data:{user:{id:'synthetic-user'}}};}}}};
 const m=load('supabase/functions/create-signup-user/index.ts',{'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>db},'../_shared/cors.ts':{corsForRequest:()=>({})},'../_shared/auth-user-lookup.ts':{lookupAuthUser:async()=>null},'../_shared/rate-limit.ts':{allowRequest:async()=>true}},{SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'fake'});
 const response=await m.handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({email:'noncustomer@example.invalid',password:'synthetic-password-only',profileData:{user_type:'private',username:'audit'}})}));
 if(response.status!==200)throw new Error('Signup audit fixture error '+response.status);
 record('Private signup does not claim OTP verification before email proof',false,Boolean(created?.app_metadata?.signup_otp_verified_at));
 record('Private signup does not auto-confirm email before email proof',false,Boolean(created?.email_confirm));
}
function stripeVerificationReadiness(){
 const source=fs.readFileSync('supabase/functions/stripe-verify-business-bank-account/index.ts','utf8');
 const fragment=source.slice(source.indexOf('const mapVerificationFromStripe'),source.indexOf('Deno.serve'))+'\nexports.map=mapVerificationFromStripe;';
 const exports={};vm.runInNewContext(ts.transpileModule(fragment,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
 const result=exports.map({status:'validated'},{payouts_enabled:false,requirements:{disabled_reason:'requirements.past_due'}});
 record('Stripe bank readiness rejects disabled payout accounts',false,result.verified);
}
async function legacyHttpErrorStatus(){
 const db={auth:{getUser:async()=>({data:{user:{id:'synthetic-user'}}})},from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({error:{message:'synthetic DB outage'}})})};
 const m=load('supabase/functions/paystack-reconcile-subaccount-settlements/index.ts',{'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>db},'../_shared/cors.ts':{corsForRequest:()=>({})},'../_shared/owner-wallet-balance.ts':{calculateOwnerWalletBalance:()=>0}},{SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'fake',PAYSTACK_SECRET_KEY:'fake'});
 const r=await m.handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:'{}'}));
 record('Settlement reconciliation DB failure uses a 5xx HTTP status',true,r.status>=500);
 results.push({name:'Legacy HTTP failure reproduction',actual_status:r.status,body:await r.json()});
}
async function localOnlyWalletFunding(){
 const source=fs.readFileSync('store/wallet-store.ts','utf8'),ast=ts.createSourceFile('wallet-store.ts',source,ts.ScriptTarget.Latest,true);let initializer;
 function visit(n){if(ts.isPropertyAssignment(n)&&n.name.getText(ast)==='addFunds')initializer=n.initializer.getText(ast);ts.forEachChild(n,visit);}visit(ast);
 let state={wallet:{id:'synthetic-wallet',balance:100},transactions:[],paymentMethods:[{id:'synthetic-card'}]},calls=0;
 const exports={};vm.runInNewContext(ts.transpileModule('exports.addFunds='+initializer,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,get:()=>state,set:patch=>Object.assign(state,patch),setTimeout:fn=>{fn();return 0;},TRANSACTION_FEE_PERCENTAGE:.04,Date});
 await exports.addFunds(50,'synthetic-card');
 record('Card wallet funding does not report success without server payment evidence',100,state.wallet.balance);
 results.push({name:'Local wallet funding reproduction',server_network_calls:calls,local_balance:state.wallet.balance,local_transaction_status:state.transactions[0]?.status});
}
(async()=>{await paystackStatuses();await actualFundingCallback();await welcomeRejectedRetry();await privateSignup();stripeVerificationReadiness();await legacyHttpErrorStatus();await localOnlyWalletFunding();fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/edge-case-audit.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));process.exitCode=results.some(row=>row.status==='FAIL')?1:0;})().catch(error=>{console.error(error);process.exitCode=1;});
