const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/password-recovery.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:exportsObject});
const {verifyRecoveryCode, updateRecoveredPassword}=exportsObject;
test('a recovery code must establish a session and uses Supabase recovery verification',async()=>{
  let result={data:{session:null},error:{message:'invalid'}};
  const client={auth:{verifyOtp:async input=>{assert.equal(input.email,'user@example.com');assert.equal(input.token,'123456');assert.equal(input.type,'recovery');return result;}}};
  assert.equal(await verifyRecoveryCode(client,' User@Example.com ','123456'),false);
  result={data:{session:null},error:null};assert.equal(await verifyRecoveryCode(client,'user@example.com','123456'),false);
  result={data:{session:{access_token:'verified'}},error:null};assert.equal(await verifyRecoveryCode(client,'user@example.com','123456'),true);
});
test('password mutation is denied without a user session',async()=>{
 let writes=0;
 await assert.rejects(updateRecoveredPassword({auth:{getSession:async()=>({data:{session:null},error:null}),updateUser:async()=>{writes++;}}},'Example123'),/expired/);
 assert.equal(writes,0);
});
test('password changes use only the current user session, then sign out',async()=>{
 const calls=[];
 await updateRecoveredPassword({auth:{getSession:async()=>({data:{session:{user:{id:'verified-user'}}},error:null}),updateUser:async input=>{calls.push(input);return {error:null};},signOut:async()=>calls.push('signed out')}},'Example123');
 assert.equal(JSON.stringify(calls),JSON.stringify([{password:'Example123'},'signed out']));
});
for(const name of ['update-password-by-uid','get-uid-by-email'])test(`${name} refuses all requests, including public-key requests`,async()=>{
 let handler;
 const source=fs.readFileSync(`supabase/functions/${name}/index.ts`,'utf8').replace(/^import .*;$/gm,'');
 vm.runInNewContext(ts.transpile(source),{Response,Deno:{serve:fn=>handler=fn},corsForRequest:()=>({})});
 assert.equal((await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify({uid:'victim',newPassword:'Example123'})}))).status,410);
 assert.equal((await handler(new Request('https://example.test',{method:'OPTIONS'}))).status,204);
});
