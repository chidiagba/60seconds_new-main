const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
const loaded={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('utils/checkout-payment-methods.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:loaded});
test('the selected method determines both provider and channel for an NGN cart',()=>{
 assert.equal(loaded.checkoutPaymentRoute('paystack_card','NGN').channel,'card');
 assert.equal(loaded.checkoutPaymentRoute('paystack_transfer','NGN').channel,'bank_transfer');
 assert.equal(loaded.checkoutPaymentRoute('stripe_card','NGN').provider,'stripe');
 assert.equal(loaded.checkoutPaymentOptions('NGN')[0].provider,'paystack');
});
test('non-NGN carts cannot choose unsupported Paystack methods',()=>{
 assert.equal(loaded.checkoutPaymentOptions('EUR').length,1);
 assert.equal(loaded.checkoutPaymentRoute('stripe_card','EUR').provider,'stripe');
 assert.throws(()=>loaded.checkoutPaymentRoute('paystack_transfer','EUR'),/unavailable/);
});
