const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/video-feed.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exportsObject, console: { warn() {} } });
function fixture(result) {
  const calls = [];
  const rows = Array.from({length:45}, (_, i) => ({id:`video-${i}`,created_at:`202${i%7}-01-01`}));
  let selection;
  const query = { select(value) { selection=value; return this; }, order() { return this; }, range(a,b) { calls.push([selection,a,b]); return Promise.resolve({data:rows.slice(a,b+1),error:null}); }, in(field,ids) {calls.push(['ids',...ids]);return Promise.resolve({data:rows.filter(row=>ids.includes(row.id)),error:null});} };
  const client = { rpc: async () => { calls.push('rpc'); return result; }, from: () => query };
  return { load: exportsObject.createVideoFeedLoader(client), calls };
}
test('missing RPC still randomizes all dates with stable, non-overlapping pagination', async () => {
 const f=fixture({data:null,error:{code:'PGRST202'}});
 const first=(await f.load(20,0,'seed-a')).data;
 const next=(await f.load(20,20,'seed-a')).data;
 assert.equal(first.length,20); assert.equal(next.length,20);
 assert.equal(new Set([...first,...next].map(v=>v.id)).size,40);
 assert.ok(first.some(v=>v.created_at.startsWith('2020')));
 const repeat=(await f.load(20,0,'seed-a')).data;
 assert.deepEqual(first,repeat);
 const reopened=(await f.load(20,0,'seed-b')).data;
 assert.notDeepEqual(first.map(v=>v.id),reopened.map(v=>v.id));
 assert.equal(f.calls.filter(v=>v==='rpc').length,1);
});
test('working randomized feed is used', async () => {
 const result={data:[{id:'random'}],error:null}; const f=fixture(result);
 assert.equal(await f.load(20,0,'seed'),result); assert.deepEqual(f.calls,['rpc']);
});
test('other server errors are preserved instead of hidden by a fallback', async () => {
 const result={data:null,error:{code:'42501'}}; const f=fixture(result);
 assert.equal(await f.load(20,0,'seed'),result); assert.deepEqual(f.calls,['rpc']);
});
test('unseeded feeds retain chronological pagination', async () => {
 const f=fixture(null); await f.load(10,30); assert.deepEqual(f.calls,[['*',30,39]]);
});
