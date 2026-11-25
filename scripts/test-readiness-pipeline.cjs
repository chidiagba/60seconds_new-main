/** Local integration only: real PostgreSQL RPCs + actual Edge handlers + stub provider transport.
 * Rejects any non-local DB URL and has no external network implementation.
 */
const fs=require('fs'),vm=require('vm'),ts=require('typescript'),cp=require('child_process'),assert=require('assert/strict');
const {webcrypto,createHmac,randomUUID}=require('crypto');
const url=process.env.TEST_DATABASE_URL;
const parsed=new URL(url||'postgresql:///invalid');
if(!url?.startsWith('postgresql:///')||parsed.hostname||parsed.search||parsed.hash||!/^\/review_readiness_[A-Za-z0-9_]+$/.test(parsed.pathname))throw new Error('Requires isolated local readiness database with no connection overrides');
const databaseName=parsed.pathname.slice(1);
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
function sql(q){return cp.execFileSync('psql',['-h','/tmp','-p','5432','-d',databaseName,'-XAt','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8'}).trim();}
function json(q){return JSON.parse(sql(q)||'null');}
const uid=randomUUID(),bank=randomUUID(),uid2=randomUUID(),bank2=randomUUID();
for(const [u,b,c,p] of [[uid,bank,'NGN','paystack'],[uid2,bank2,'USD','stripe']]){
 sql(`INSERT INTO auth.users(id,email) VALUES(${quote(u)},${quote(u+'@example.invalid')}); INSERT INTO profiles(id,email,country_code) VALUES(${quote(u)},${quote(u+'@example.invalid')},${quote(p==='stripe'?'US':'NG')}); INSERT INTO wallets(user_id,balance,currency,is_active) VALUES(${quote(u)},100,${quote(c)},true) ON CONFLICT(user_id) DO UPDATE SET balance=100,currency=${quote(c)}; INSERT INTO business_bank_accounts(id,user_id,bank_name,account_holder_name,account_number,country,country_code,currency,payout_provider,is_verified,verification_status,verification_source,paystack_recipient_code,stripe_connected_account_id,stripe_external_account_id) VALUES(${quote(b)},${quote(u)},'Synthetic Bank','Synthetic Owner','0000000000',${quote(p==='stripe'?'United States':'Nigeria')},${quote(p==='stripe'?'US':'NG')},${quote(c)},${quote(p)},true,'verified','server_v2','RCP_test','acct_test','ba_test');`);
}
const balance=u=>Number(sql(`SELECT balance FROM wallets WHERE user_id=${quote(u)}`));
let caller=uid,providerCalls=0,paystackTransfer,fundingPayment,stripePaid=false,stripeFailed=false,stripeReversed=false,refundReject=true,refundPosts=0,refunds=[];
const guestOrder=randomUUID(),guestRef='guest_paystack_'+guestOrder;
function chain(table){let filters=[],patch=null;const c={select(){return c},eq(k,v){filters.push(`${k}=${quote(v)}`);return c},update(p){patch=p;return c},maybeSingle:async()=>read(),single:async()=>read(),then(resolve){resolve(read())}};function read(){const where=filters.length?' WHERE '+filters.join(' AND '):'';if(patch){sql(`UPDATE public.${table} SET ${Object.entries(patch).map(([k,v])=>k+'='+quote(v)).join(',')}${where}`);return{error:null};}return{data:json(`SELECT row_to_json(r) FROM (SELECT * FROM public.${table}${where} LIMIT 1)r`),error:null};}return c;}
const db={auth:{getUser:async()=>({data:{user:{id:caller,email:caller+'@example.invalid'}}})},from:chain,rpc:async(name,args)=>{
 try {return{data:json(`SELECT to_jsonb(public.${name}(${Object.entries(args).map(([k,v])=>`${k}=>${v===null?'NULL':typeof v==='object'?quote(JSON.stringify(v))+'::jsonb':quote(v)}`).join(',')}))`),error:null};}
 catch(error){return{data:null,error:{message:error.message}};}
}};
const env={SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'fake-service',PAYSTACK_SECRET_KEY:'fake-paystack-signing-key',STRIPE_SECRET_KEY:'fake-stripe-test',ALLOWED_ORIGINS:'https://test.invalid'};
const fetch=async(path,options={})=>{
 providerCalls++;const body=options.body?JSON.parse(options.body):null;
 if(path.endsWith('/transfer')){assert.equal(balance(uid),40);paystackTransfer={reference:body.reference,amount:body.amount,currency:'NGN',recipient:{recipient_code:body.recipient},status:'pending',transfer_code:'TRF_test'};return{ok:true,json:async()=>({status:true,data:paystackTransfer})};}
 if(path.includes('/transfer/verify/'))return{ok:true,json:async()=>({status:true,data:paystackTransfer})};
 if(path.endsWith('/transaction/initialize')){fundingPayment={id:100,reference:body.reference,amount:body.amount,currency:body.currency,status:'success',metadata:body.metadata};return{ok:true,json:async()=>({status:true,data:{authorization_url:'https://checkout.paystack.com/synthetic',access_code:'synthetic'}})};}
 if(path.includes('/transaction/verify/'))return{ok:true,json:async()=>({status:true,data:{id:999,reference:guestRef,status:'success',amount:104000,currency:'NGN',metadata:{guest_order_id:guestOrder}}})};
 if(path.includes('/refund?'))return{ok:true,json:async()=>({status:true,data:refunds})};
 if(path.endsWith('/refund')){refundPosts++;assert.equal(body.reference,'refund_'+guestOrder);if(refundReject)return{ok:false,json:async()=>({status:false,message:'Synthetic rejection'})};refunds=[{id:77,amount:104000,status:'pending'}];return{ok:true,json:async()=>({status:true,data:refunds[0]})};}
 throw new Error('External network blocked: '+path);
};
class Stripe {constructor(){this.transfers={create:async()=>{assert.equal(balance(uid2),40);return{id:'tr_test',amount:6000,destination:'acct_test',reversed:false};},retrieve:async()=>({id:'tr_test',amount:6000,destination:'acct_test',reversed:stripeReversed}),createReversal:async()=>{stripeReversed=true;return{amount:6000};}};this.payouts={create:async()=>({id:'po_test',amount:6000,destination:'ba_test',status:'pending'}),retrieve:async()=>({id:'po_test',amount:6000,destination:'ba_test',status:stripeFailed?'failed':stripePaid?'paid':'pending'})};}}
let withdrawal;
function load(file){let handler;const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,Request,Response,URL,AbortSignal,crypto:webcrypto,TextEncoder,Uint8Array,Date,fetch,console:{error(){},warn(){}},Deno:{env:{get:key=>env[key]},serve:fn=>handler=fn},require:name=>{
 if(name.includes('supabase-js'))return{createClient:()=>db};if(name==='npm:stripe')return Stripe;if(name.includes('cors'))return{corsForRequest:()=>({})};if(name.includes('logger'))return{logger:{debug(){}}};if(name.includes('commerce-rules'))return{currencyDigits:()=>2,toMinorUnits:a=>Math.round(a*100)};if(name.includes('withdrawals'))return withdrawal;if(name.includes('guest-paystack'))return{reconcileGuestPaystack:()=>{throw new Error('Guest flow not in webhook test');}};if(name.includes('guest-fulfillment'))return{fulfillGuestSession:()=>{throw new Error('No email or receipt delivery permitted');}};if(name.includes('edge-runtime'))return{};throw new Error('Unmocked import '+name);
 }});return{exports,handler};}
const request=body=>new Request('https://synthetic.invalid',{method:'POST',headers:{authorization:'Bearer synthetic-session'},body:JSON.stringify(body)});
async function main(){
 withdrawal=load('supabase/functions/_shared/withdrawals.ts').exports;
 const webhook=load('supabase/functions/paystack-webhook-settlement/index.ts').handler;
 const deliver=async(event,data)=>{const body=JSON.stringify({event,data}),signature=createHmac('sha512',env.PAYSTACK_SECRET_KEY).update(body).digest('hex');return webhook(new Request('https://synthetic.invalid',{method:'POST',headers:{'x-paystack-signature':signature},body}));};
 const h=withdrawal.withdrawalHandler('paystack'),body={amount:60,businessBankAccountId:bank,idempotencyKey:randomUUID()};
 assert.equal((await h(request(body))).status,202);assert.equal(balance(uid),40);
 paystackTransfer.status='success';assert.equal((await deliver('transfer.success',paystackTransfer)).status,200);assert.equal(balance(uid),40);
 const transferCreates=providerCalls;assert.equal((await h(request(body))).status,200);assert.equal(providerCalls,transferCreates);
 paystackTransfer.status='reversed';assert.equal((await deliver('transfer.reversed',paystackTransfer)).status,200);assert.equal(balance(uid),100);await deliver('transfer.reversed',paystackTransfer);assert.equal(balance(uid),100);
 const initializer=load('supabase/functions/paystack-initialize/index.ts').handler;
 assert.equal((await initializer(request({amount:100,currency:'NGN',metadata:{paymentType:'wallet_funding'}}))).status,200);
 await deliver('charge.success',fundingPayment);await deliver('charge.success',fundingPayment);assert.equal(balance(uid),200);
 caller=uid2;const s=withdrawal.withdrawalHandler('stripe');const response=await s(request({amount:60,businessBankAccountId:bank2,idempotencyKey:randomUUID()}));assert.equal(response.status,202);assert.equal(balance(uid2),40);const ref=(await response.json()).reference;
 stripePaid=true;let hold=chain('withdrawal_holds');hold.eq('reference',ref);await withdrawal.processWithdrawal(db,(await hold.single()).data);assert.equal(balance(uid2),40);
 stripeFailed=true;hold=chain('withdrawal_holds');hold.eq('reference',ref);const row=(await hold.single()).data;await withdrawal.processWithdrawal(db,{...row,state:'pending'});assert.equal(balance(uid2),100);
 sql(`INSERT INTO orders(id,user_id,order_number,items,subtotal,total_amount,currency,guest_email) VALUES(${quote(guestOrder)},NULL,${quote('AUDIT-'+guestOrder)},'[]',1000,1040,'NGN','noncustomer@example.invalid'); INSERT INTO guest_checkouts(order_id,session_id,state,provider,expires_at) VALUES(${quote(guestOrder)},${quote(guestRef)},'released','paystack',now()-interval '1 hour');`);
 const guest=load('supabase/functions/_shared/guest-paystack.ts').exports;
 await assert.rejects(guest.reconcileGuestPaystack(db,guestRef));
 assert.equal(sql(`SELECT refund_pending FROM guest_checkouts WHERE order_id=${quote(guestOrder)}`),'t');
 assert.equal((await guest.reconcileGuestPaystack(db,guestRef)).status,202);assert.equal(refundPosts,1);
 sql(`UPDATE guest_checkouts SET refund_claimed_at=now()-interval '11 minutes' WHERE order_id=${quote(guestOrder)}`);
 refundReject=false;assert.equal((await guest.reconcileGuestPaystack(db,guestRef)).status,200);assert.equal(refundPosts,2);
 await guest.reconcileGuestPaystack(db,guestRef);assert.equal(refundPosts,2);
 const result={status:'PASS',boundary:'real local PostgreSQL and actual handlers; fake Auth/provider transport; no external provider calls',paystack_withdrawal_signed_success_reversal_replay:'PASS',paystack_wallet_funding_signed_charge_replay:'PASS',stripe_withdrawal_poll_complete_and_failed_payout_reversal:'PASS',paystack_refund_rejection_lease_retry_and_duplicate_suppression:'PASS',final_ngn_balance:balance(uid),final_usd_balance:balance(uid2)};
 fs.writeFileSync('build/production-readiness-20261122/local-integration.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
