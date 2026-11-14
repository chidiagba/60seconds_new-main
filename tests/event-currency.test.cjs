const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('utils/country-currency.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:exportsObject,Error});
const {resolveEventCurrency}=exportsObject;
for (const currency of ['NGN','CHF','PKR','EUR','GBP','JPY','USD']) {
  test(`publishing preserves selected ${currency} rather than the account's default`,()=>{
    assert.equal(resolveEventCurrency([{currency},{currency:currency.toLowerCase()}],'USD'),currency);
  });
}
test('offers with no currency inherit the selected event currency',()=>{
  assert.equal(resolveEventCurrency([{currency:' chf '},{}],'USD'),'CHF');
});
test('events without priced offers retain their event/account currency',()=>{
  assert.equal(resolveEventCurrency([],' ngn '),'NGN');
});
test('different currencies cannot be mislabeled or added into one checkout total',()=>{
  assert.throws(()=>resolveEventCurrency([{currency:'NGN'},{currency:'USD'}],'USD'),/same currency/);
  assert.throws(()=>resolveEventCurrency([{currency:'dollars'}],'USD'),/valid event currency/);
});
function creationService() {
  const saved={};
  const db={auth:{getUser:async()=>({data:{user:{id:'owner'}},error:null})},from(table){
    if(table==='profiles') return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{country_code:'US',user_type:'business'}})};
    return {insert(value){saved[table]=value;return this;},select(){return table==='events'?this:Promise.resolve({data:saved[table],error:null});},single:async()=>({data:{id:'event',...saved.events},error:null})};
  }};
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/event-creation-service.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,Error,console:{log(){},error(){}},require:name=>name==='@/lib/logger'?{logger:require('./logger-fixture.cjs')}:name==='./supabase'?{supabase:db}:exportsObject});
  return {service:exports.EventCreationService,saved};
}
test('saved event, offers, and shared-page checkout keep the selected currency together',async()=>{
  const {service,saved}=creationService();
  const result=await service.createEventWithRelations({event:{event_name:'NGN Event',currency:'USD'},products:[{name:'Ticket',price:5000,currency:' ngn ',available_quantity:20},{name:'Drink',price:1000,available_quantity:10}]});
  assert.equal(result.success,true);
  assert.equal(saved.events.currency,'NGN');
  assert.equal(saved.products[0].currency,'NGN');
  assert.equal(saved.products[1].currency,'NGN');
});
test('mixed currency validation happens before writing any event',async()=>{
  const {service,saved}=creationService();
  const result=await service.createEventWithRelations({event:{event_name:'Mixed'},products:[{currency:'NGN'},{currency:'CHF'}]});
  assert.equal(result.success,false);
  assert.match(result.error,/same currency/);
  assert.equal(saved.events,undefined);
});
test('a delayed account lookup cannot overwrite a manually selected currency',async()=>{
  const source=fs.readFileSync('components/ProductCreationModal.tsx','utf8');
  const ast=ts.createSourceFile('modal.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(ast)==='fetchUserData')) declaration=node.getText(ast);
    ts.forEachChild(node,visit);
  }
  visit(ast);
  assert.ok(declaration);
  const updates=[];
  const context={cancelled:false,currencySelectedRef:{current:false},initialProduct:undefined,defaultCurrency:'USD',
    setEventOwnerId(){},setResolvedCurrency:value=>updates.push(value),resolveCurrencyFromCountry:exportsObject.resolveCurrencyFromCountry,
    supabase:{auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from(){return {select(){return this;},eq(){return this;},maybeSingle:async()=>{context.currencySelectedRef.current=true;return {data:{country_code:'US'}};}};}},
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(declaration+'\nglobalThis.fetchUser=fetchUserData;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);
  await context.fetchUser();
  assert.deepEqual(updates,[]);
});
