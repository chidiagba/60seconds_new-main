const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(platform, initStripe) {
  const context={exports:{},process:{env:{EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY:'pk_test_fixture'}},require:name=>name==='react-native'?{Platform:{OS:platform}}:{initStripe}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/stripe-initialization.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context);
  return context.exports.ensureStripeInitialized;
}
test('Stripe does no native startup work and concurrent checkouts initialize once', async()=>{
  let count=0;
  const ensure=load('android',async()=>{count++;});
  assert.equal(count,0);
  await Promise.all([ensure(),ensure()]);
  assert.equal(count,1);
  await ensure();
  assert.equal(count,1);
});
test('a failed checkout initialization can be retried',async()=>{
  let count=0;
  const ensure=load('android',async()=>{if(++count===1) throw new Error('Not ready');});
  await assert.rejects(ensure(),/Not ready/);
  await ensure();
  assert.equal(count,2);
});
test('iOS retains its existing provider initialization',async()=>{
  await load('ios',()=>assert.fail('Must not initialize twice'))();
});
