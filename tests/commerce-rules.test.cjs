const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const compiled = ts.transpileModule(fs.readFileSync('utils/commerce-rules.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const exportsObject = {};
vm.runInNewContext(compiled,{exports:exportsObject});
const { eventShareExpired, voucherDiscount } = exportsObject;
const now = Date.parse('2026-10-04T12:00:00Z');
const voucher = {businessId:'seller-a',isActive:true,usageCount:0,usageLimit:2,discountType:'percentage',discountValue:25};
test('event share is available until, but not at, the 48-hour expiry',()=>{
 assert.equal(eventShareExpired('2026-10-02T12:00:00Z','2026-10-01T12:00:00Z',now-1),false);
 assert.equal(eventShareExpired('2026-10-02T12:00:00Z','2026-10-01T12:00:00Z',now),true);
 assert.equal(eventShareExpired(null,'2026-10-02T12:00:00Z',now),true);
 assert.equal(eventShareExpired('bad','bad',now),true);
});
test('discounts round to cents and never exceed order or cap',()=>{
 assert.equal(voucherDiscount(voucher,10),2.5);
 assert.equal(voucherDiscount({...voucher,discountValue:33},10.01),3.3);
 assert.equal(voucherDiscount({...voucher,maxDiscountAmount:1},100),1);
 assert.equal(voucherDiscount({...voucher,discountType:'fixed',discountValue:200},100),100);
 assert.equal(voucherDiscount({...voucher,maxDiscountAmount:0},100),0);
});
test('reject inactive, expired, exhausted, wrong seller and wrong product vouchers',()=>{
 for (const value of [{isActive:false},{expiryDate:'2026-10-04T12:00:00Z'},{expiryDate:'invalid'},{usageCount:2},{usageLimit:0},{minPurchaseAmount:101},{discountValue:-1},{discountValue:101}])
  assert.throws(()=>voucherDiscount({...voucher,...value},100,undefined,'seller-a',now));
 assert.throws(()=>voucherDiscount(voucher,100,undefined,'seller-b',now));
 assert.throws(()=>voucherDiscount({...voucher,productId:'ticket'},100,'drink','seller-a',now));
 assert.throws(()=>voucherDiscount(voucher,NaN));
});
test('unlimited vouchers and matching product are accepted',()=>{
 assert.equal(voucherDiscount({...voucher,usageLimit:null,usageCount:999,productId:'ticket'},100,'ticket','seller-a',now),25);
});
test('guest prices use the correct Stripe minor units',()=>{
 assert.equal(exportsObject.toMinorUnits(10.5,'CHF'),1050);
 assert.equal(exportsObject.toMinorUnits(100,'JPY'),100);
 assert.equal(exportsObject.markedPrice(100,'JPY'),104);
 assert.equal(exportsObject.markedPrice(9,'JPY'),9);
});
