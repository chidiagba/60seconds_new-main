const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');
const exportsObject={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('utils/voucher-fields.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:exportsObject,Error});
const {voucherDiscountFields,legacyVoucherFields,isLegacyVoucherSchemaError}=exportsObject;
test('reads percentage and fixed vouchers from the deployed legacy schema',()=>{
  assert.equal(voucherDiscountFields({discount_percentage:25,discount_amount:null}).discountType,'percentage');
  assert.equal(voucherDiscountFields({discount_percentage:25,discount_amount:null}).discountValue,25);
  assert.equal(voucherDiscountFields({discount_percentage:null,discount_amount:500}).discountType,'fixed');
  assert.equal(voucherDiscountFields({discount_type:'percentage',discount_value:10,discount_amount:null}).discountValue,10);
});
test('legacy creation supplies both ownership fields and exactly one discount',()=>{
  for(const type of ['percentage','fixed']) {
    const row=legacyVoucherFields({business_id:'owner',code:'SAVE',discount_type:type,discount_value:25});
    assert.equal(row.creator_id,'owner');
    assert.equal(row.discount_percentage,type==='percentage'?25:null);
    assert.equal(row.discount_amount,type==='fixed'?25:null);
    assert.equal(row.discount_type,undefined);
  }
});
test('schema fallback never retries permissions or silently widens a product voucher',()=>{
  assert.equal(isLegacyVoucherSchemaError({code:'42501',message:'discount_type'}),false);
  assert.equal(isLegacyVoucherSchemaError({code:'PGRST204',message:'missing discount_value'}),true);
  assert.throws(()=>legacyVoucherFields({product_id:'product'}),/Product-specific/);
});
