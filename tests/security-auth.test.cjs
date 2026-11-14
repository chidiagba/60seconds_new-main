const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function load(file,dependencies={}) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,{exports,Request,Response,Buffer,process,console,require:name=>name in dependencies?dependencies[name]:require(name)});
 return exports;
}
test('protected tRPC procedures reject missing/invalid tokens and use verified identity',async()=>{
 const checked=[];
 const api=load('backend/trpc/create-context.ts',{'../lib/supabase':{supabase:{auth:{getUser:async token=>{checked.push(token);return token==='valid'?{data:{user:{id:'verified-user'}},error:null}:{data:{user:null},error:{message:'invalid'}};}}}}});
 const router=api.createTRPCRouter({identity:api.protectedProcedure.query(({ctx})=>ctx.user.id)});
 for(const token of [null,'invalid']){
  const ctx=await api.createContext({req:new Request('https://example.test',{headers:token?{authorization:`Bearer ${token}`}:{}})});
  await assert.rejects(router.createCaller(ctx).identity(),error=>error.code==='UNAUTHORIZED');
 }
 const ctx=await api.createContext({req:new Request('https://example.test',{headers:{authorization:'Bearer valid'}})});
 assert.equal(await router.createCaller(ctx).identity(),'verified-user');
 assert.deepEqual(checked,['invalid','valid']);
});
test('retired payment procedures cannot be invoked',async()=>{
 const api=load('backend/trpc/create-context.ts',{'../lib/supabase':{supabase:{}}});
 let calls=0;const router=api.createTRPCRouter({retired:api.disabledProcedure.mutation(()=>{calls++;})});
 await assert.rejects(router.createCaller({user:{id:'user'}}).retired(),error=>error.code==='NOT_FOUND');assert.equal(calls,0);
});
test('Paystack signature binds exact bytes and rejects missing, malformed or altered signatures',()=>{
 const {createHmac}=require('node:crypto');
 const {verifyPaystackSignature}=load('backend/lib/paystack-signature.ts');
 const body='{"event":"charge.success", "data":{"amount":100}}';const secret='unit-test-secret';const signature=createHmac('sha512',secret).update(body).digest('hex');
 assert.equal(verifyPaystackSignature(body,signature,secret),true);
 for(const bad of [undefined,'','a',signature.slice(1),'g'.repeat(128),'0'.repeat(128)])assert.equal(verifyPaystackSignature(body,bad,secret),false);
 assert.equal(verifyPaystackSignature(body+' ',signature,secret),false);
 assert.equal(verifyPaystackSignature(body,signature,''),false);
});
test('server configuration fails without required service credentials',()=>{
 const {requiredEnv}=load('backend/lib/env.ts');
 assert.throws(()=>requiredEnv('REVIEW_MISSING_REQUIRED_VARIABLE'),/Missing required/);
});
test('CORS only allows configured website origins',()=>{
 const source=fs.readFileSync('supabase/functions/_shared/cors.ts','utf8');const exports={};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,Deno:{env:{get:()=>undefined}}});
 assert.equal(exports.corsForRequest(new Request('https://api.example',{headers:{origin:'https://attacker.example'}}))['Access-Control-Allow-Origin'],undefined);
 assert.equal(exports.corsForRequest(new Request('https://api.example',{headers:{origin:'https://60secondsapp.io'}}))['Access-Control-Allow-Origin'],'https://60secondsapp.io');
});
test('account deletion ignores an attacker-supplied user ID',async()=>{
 const api=load('backend/trpc/create-context.ts',{'../lib/supabase':{supabase:{}}});
 const targets=[];
 const db={from:()=>({delete(){return this;},eq:async(column,id)=>{targets.push(id);return {error:null};}}),auth:{admin:{deleteUser:async id=>{targets.push(id);return {error:null};}}}};
 const {deleteAccountProcedure}=load('backend/trpc/routes/account/delete/route.ts',{
   '../../../create-context':api,'@/backend/lib/supabase':{supabase:db},'../../../../lib/logger':{logger:{debug(){}}},
 });
 const caller=api.createTRPCRouter({remove:deleteAccountProcedure}).createCaller({user:{id:'verified-user'}});
 await caller.remove({userId:'00000000-0000-0000-0000-000000000099'});
 assert.equal(targets.length,6);assert.ok(targets.every(id=>id==='verified-user'));
});
