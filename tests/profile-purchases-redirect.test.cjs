const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function redirect(type,params) {
 const exports={};
 const code=ts.transpileModule(fs.readFileSync('app/profile.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,require(name){
  if(name==='react/jsx-runtime')return {jsx:(_,props)=>props};
  if(name==='expo-router')return {Redirect:'Redirect',useLocalSearchParams:()=>params};
  return {useAuth:()=>({profile:{user_type:type}})};
 }});
 return exports.default().href;
}
for(const type of ['business','personal'])test(`${type} profile links open requested purchases tab`,()=>{
 const href=redirect(type,{tab:'orders'});
 assert.equal(href.pathname,type==='business'?'/(tabsbusiness)/profile':'/(tabs)/profile');
 assert.equal(href.params.tab,'orders');
});
test('other-user profile links do not forward the private purchases tab',()=>{
 const href=redirect('personal',{userId:'other-user',tab:'orders'});
 assert.equal(href.params.userId,'other-user');assert.equal(href.params.tab,undefined);
});
