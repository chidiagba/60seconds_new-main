const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
const exportsFor={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('utils/checkout-selection.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:exportsFor,Map});
const {validatedVoucherSelection,checkoutVoucherRequest}=exportsFor;
const voucher={id:'v',code:'FREE'},items=[{productId:'p',quantity:1}];
const quote={voucher_id:'v',voucher_code:'FREE',items:[{product_id:'p',quantity:1}],discount_amount:1040,total_amount:0};
test('validated voucher survives unrelated voucher-list refresh instead of being looked up again',()=>{
 const generalVoucherList=[];assert.equal(generalVoucherList.find(v=>v.code==='FREE'),undefined);
 const selected=validatedVoucherSelection(voucher,quote,items);
 assert.equal(selected.activeVoucher.id,'v');
 const request=checkoutVoucherRequest(selected.activeVoucher,selected.checkoutQuote);
 assert.equal(request.voucherCode,'FREE');assert.equal(request.voucherId,'v');
});
test('selected voucher cannot silently disappear from the backend creation payload',()=>{
 assert.throws(()=>checkoutVoucherRequest(voucher,{...quote,voucher_id:null}),/not included/);
 assert.throws(()=>validatedVoucherSelection(voucher,quote,[{productId:'p',quantity:2}]),/Cart changed/);
 assert.throws(()=>validatedVoucherSelection(voucher,{...quote,voucher_code:'OTHER'},items),/does not match/);
});
test('checkout request key survives process restart before financial requests',async()=>{
 const module={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/checkout-attempt.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:module,require:()=>exportsFor});
 const data=new Map();const storage={getItem:async k=>data.get(k)||null,setItem:async(k,v)=>{data.set(k,v)},removeItem:async k=>data.delete(k)};
 const first=await module.loadCheckoutAttempt(storage,'buyer',items,()=> 'attempt-original');
 const afterRestart=await module.loadCheckoutAttempt(storage,'buyer',items,()=> 'attempt-duplicate');
 assert.equal(first.requestKey,afterRestart.requestKey);
 const otherBuyer=await module.loadCheckoutAttempt(storage,'other-buyer',items,()=> 'attempt-other');assert.notEqual(first.storageKey,otherBuyer.storageKey);
 await storage.removeItem(first.storageKey);const nextPurchase=await module.loadCheckoutAttempt(storage,'buyer',items,()=> 'attempt-next');assert.equal(nextPurchase.requestKey,'attempt-next');
});
test('voucher timestamp expiry retains its exact instant while DATE remains valid through UTC day',()=>{
 const loaded={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('utils/voucher-expiry.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:loaded,Date});
 const {voucherExpiryInstant}=loaded;
 assert.equal(voucherExpiryInstant('2026-11-29T07:07:00Z'),Date.parse('2026-11-29T07:07:00Z'));
 assert.equal(voucherExpiryInstant('2026-11-29'),Date.parse('2026-11-29T23:59:59.999Z'));
 assert.equal(voucherExpiryInstant(null),Infinity);
});
