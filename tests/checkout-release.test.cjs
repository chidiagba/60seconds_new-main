const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),ts=require('typescript'),vm=require('node:vm');
const errors={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('utils/checkout-errors.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:errors});
test('checkout errors suppress database internals, provider payloads and untrusted text',()=>{
 for(const message of ['Could not find public.get_checkout_attempt in the schema cache','secret-token','permission denied for relation orders','<script>alert(1)</script>','toString','__proto__']) {
  const friendly=errors.checkoutErrorMessage({message,code:'PGRST202'});
  assert.match(friendly,/temporarily unavailable/);assert.ok(!friendly.includes(message));
 }
 assert.equal(errors.checkoutErrorCode({code:'PGRST202'}),'PGRST202');
 assert.equal(errors.checkoutErrorCode({code:'secret / path'}),'CHECKOUT_FAILED');
 assert.match(errors.checkoutErrorMessage({message:'Sign in before checkout'}),/sign in/);
});
test('release preparation includes full ordered dependencies and an exact rollback rehearsal',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'checkout-release-test-'));
 try {
  require('../scripts/prepare-checkout-release.cjs').prepare(dir);
  const sql=fs.readFileSync(path.join(dir,'01_checkout_release.sql'),'utf8');
  const rehearsal=fs.readFileSync(path.join(dir,'01_checkout_release_REHEARSAL.sql'),'utf8');
  assert.equal(rehearsal,sql.replace(/COMMIT;\s*$/,'ROLLBACK;\n'));
  assert.equal((sql.match(/^BEGIN;/gm)||[]).length,1);
  assert.equal((sql.match(/^COMMIT;/gm)||[]).length,1);
  assert.ok(sql.indexOf('SOURCE: supabase/migrations/20261111080000')<sql.indexOf('SOURCE: scripts/check-voucher-release-prerequisites.sql'));
  assert.ok(sql.indexOf('SOURCE: scripts/assert-voucher-release.sql')<sql.indexOf('INSERT INTO supabase_migrations.schema_migrations'));
  assert.match(sql,/Missing customer checkout RPCs/);
  assert.match(sql,/partially\/already applied/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
