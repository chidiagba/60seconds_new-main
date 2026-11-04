const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
function load(file, requireModule) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:requireModule,Date});
  return exports;
}
const types = load('features/tables/types.ts');
const {withinBookingWindow, buildSlotsForNight} = load('features/tables/format.ts',()=>types);
test('a whole booking must fit within the business date window',()=>{
  const table={available_from:'2026-12-01T12:00:00Z',available_until:'2026-12-01T18:00:00Z',booking_duration_minutes:120};
  assert.equal(withinBookingWindow(table,new Date('2026-12-01T12:00:00Z')),true);
  assert.equal(withinBookingWindow(table,new Date('2026-12-01T16:00:00Z')),true);
  assert.equal(withinBookingWindow(table,new Date('2026-12-01T16:30:00Z')),false);
  assert.equal(withinBookingWindow(table,new Date('2026-12-01T11:30:00Z')),false);
});
test('customers can choose daytime and 17:30 arrivals, with past slots excluded',()=>{
  const slots=buildSlotsForNight(new Date(2026,11,1),new Date(2026,11,1,10,0));
  assert.ok(slots.some(d=>d.getHours()===17 && d.getMinutes()===30));
  assert.ok(slots.some(d=>d.getHours()===12));
  assert.ok(slots.every(d=>d>=new Date(2026,11,1,10,30)));
});
test('the first avatar change triggers sync and supports synchronous callbacks',async()=>{
  let version=0, count=0, ref;
  const {useAvatarSync}=load('hooks/useAvatarSync.ts',name=> name==='react' ? {
    useRef: initial=>ref || (ref={current:initial}),
    useEffect: effect=>effect(),
  } : {useAuthStore: selector=>selector({avatarVersion:version})});
  useAvatarSync(()=>{count++;});
  version=1;
  useAvatarSync(()=>{count++;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(count,1);
});
