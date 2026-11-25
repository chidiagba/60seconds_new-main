const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');

function setup({legacy=false,userId='owner',business=true,error=null}={}) {
 const source=fs.readFileSync('lib/database.ts','utf8');
 const ast=ts.createSourceFile('database.ts',source,ts.ScriptTarget.Latest,true);
 let method;
 function visit(node){
  if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='voucherService')
   method=node.initializer.properties.find(p=>p.name?.getText(ast)==='createVoucher').getText(ast);
  ts.forEachChild(node,visit);
 }
 visit(ast);
 const helpers={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('utils/voucher-fields.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:helpers,Error});
 const calls=[];
 const supabase={auth:{getUser:async()=>({data:{user:userId?{id:userId}:null}})},from:()=>({
  insert(row){calls.push(row);return this;},select(){return this;},async single(){
   if(error)return{data:null,error};
   if(legacy&&calls.length===1)return{data:null,error:{code:'PGRST204',message:'missing discount_type'}};
   const protectedFields=['id','usage_count','created_at','updated_at'];
   if(protectedFields.some(key=>Object.hasOwn(calls.at(-1),key)))return{data:null,error:{code:'42501',message:'permission denied for table vouchers'}};
   return{data:{...calls.at(-1),id:'generated',usage_count:0},error:null};
  }
 })};
 const exports={};
 vm.runInNewContext(ts.transpileModule('exports.service={'+method+'}',{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,supabase,profileService:{getProfile:async()=>({user_type:business?'business':'private'})},logger:{error(){}},...helpers,Error});
 return{create:exports.service.createVoucher,calls};
}
const voucher={business_id:'owner',code:'SAVE',name:'Offer',discount_type:'percentage',discount_value:25,usage_limit:100};
test('modern voucher creation leaves generated fields and redemption count to the database',async()=>{
 const x=setup();const result=await x.create({...voucher,usage_count:999,id:'forged',created_at:'forged',updated_at:'forged',creator_id:'forged'});
 assert.equal(x.calls.length,1);assert.equal(x.calls[0].creator_id,'owner');
 for(const key of ['id','usage_count','created_at','updated_at'])assert.equal(Object.hasOwn(x.calls[0],key),false);
 assert.equal(result.usage_count,0);assert.equal(result.id,'generated');
});
test('legacy fallback also omits protected counters and preserves discount and ownership',async()=>{
 const x=setup({legacy:true});const result=await x.create({...voucher,usage_count:0});
 assert.equal(x.calls.length,2);assert.equal(result.discount_percentage,25);assert.equal(result.creator_id,'owner');
 assert.equal(Object.hasOwn(x.calls[1],'usage_count'),false);
});
test('voucher creation retains session, business and ownership checks',async()=>{
 for(const [options,row] of [[{userId:null},voucher],[{business:false},voucher],[{}, {...voucher,business_id:'another-owner'}]]){
  const x=setup(options);await assert.rejects(()=>x.create(row));assert.equal(x.calls.length,0);
 }
});
test('permission denial is never retried as a legacy schema request',async()=>{
 const x=setup({error:{code:'42501',message:'permission denied'}});
 await assert.rejects(()=>x.create(voucher),/Permission denied/);assert.equal(x.calls.length,1);
});
