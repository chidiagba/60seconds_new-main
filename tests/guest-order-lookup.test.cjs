const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const exportsObject={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('supabase/functions/_shared/guest-order-lookup.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:exportsObject,require:name=>name.includes('guest-ticket-pdf')?{createGuestTicketPdf:async()=>{throw Error('Unexpected PDF');}}:{loadGuestTicketPages:async()=>[{qr_code_data:'TICKET:verified'}]}});
const code='019c86d5-8922-45cf-90e5-9905a7df7e20';
function db({exists=true,email='guest@example.test',state='paid',payment='completed'}={}){return{from:table=>({select(){return this;},eq(column,value){if(table==='guest_checkouts'){assert.equal(column,'tracking_code');assert.equal(value,code);}return this;},async maybeSingle(){return{error:null,data:table==='guest_checkouts'?(exists?{order_id:'order',state}:null):{id:'order',guest_email:email,order_number:'123',payment_status:payment,total_amount:1040,currency:'NGN',business_id:'owner'}};}})};}
test('guest lookup requires a private random UUID, not an order number or QR',()=>{
 assert.equal(exportsObject.validGuestTrackingCode(code),true);
 for(const bad of ['123','TICKET:123','00000000-0000-0000-0000-000000000000',null])assert.equal(exportsObject.validGuestTrackingCode(bad),false);
});
test('unknown code and wrong email produce identical non-enumerating responses',async()=>{
 const x=await exportsObject.lookupGuestOrder(db({exists:false}),{trackingCode:code,email:'guest@example.test'},'');
 const y=await exportsObject.lookupGuestOrder(db(),{trackingCode:code,email:'another@example.test'},'');
 assert.equal(x.status,404);assert.equal(JSON.stringify(x),JSON.stringify(y));
});
test('lookup returns status without exposing guest email, seller ID or payment references',async()=>{
 const result=await exportsObject.lookupGuestOrder(db(),{trackingCode:code,email:' GUEST@example.test '},'');
 assert.equal(result.status,200);assert.equal(result.body.canDownload,true);
 for(const field of ['guest_email','business_id','id','payment_reference'])assert.equal(Object.hasOwn(result.body,field),false);
});
test('reserved, failed and unverified orders cannot download tickets',async()=>{
 for(const state of [{state:'reserved'},{state:'released'},{payment:'pending'}]){
  const result=await exportsObject.lookupGuestOrder(db(state),{trackingCode:code,email:'guest@example.test',action:'ticket-pdf'},'');assert.equal(result.status,409);
 }
});
test('paid lookup renders only the authoritative receipt QR and returns a PDF filename',async()=>{
 const result=await exportsObject.lookupGuestOrder(db(),{trackingCode:code,email:'guest@example.test',action:'ticket-pdf'},'',async pages=>{assert.equal(pages[0].qr_code_data,'TICKET:verified');return'JVBERi0=';});
 assert.equal(result.status,200);assert.equal(result.body.pdf,'JVBERi0=');assert.equal(result.body.filename,'60Seconds-123.pdf');
});
test('public lookup rejects malformed bodies and enforces rate limits with no-store responses',async()=>{
 let handler;const deps={
  'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>({})},
  '../_shared/cors.ts':{corsForRequest:()=>({'Access-Control-Allow-Origin':'https://events.60secondsapp.io'})},
  '../_shared/rate-limit.ts':{allowRequest:async()=>false},
  '../_shared/guest-order-lookup.ts':{...exportsObject,lookupGuestOrder:async()=>{throw Error('Rate limit bypass');}},
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('supabase/functions/guest-order-lookup/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:{},Request,Response,JSON,Deno:{serve:fn=>handler=fn,env:{get:()=> 'test'}},require:name=>deps[name]});
 for(const [body,status] of [['{',400],['null',400],['[]',400],[JSON.stringify({trackingCode:code,email:'guest@example.test'}),429],['x'.repeat(4097),413]]){
  const response=await handler(new Request('https://test.invalid',{method:'POST',body}));assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');
 }
});
