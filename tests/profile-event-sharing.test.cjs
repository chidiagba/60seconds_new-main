const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, {exports});
  return exports;
}
const {mergeProfileAvatarFields, resolveAvatarUrl, FEMALE_AVATAR_URL} = load('utils/avatar.ts');
test('clearing a photo does not resurrect the cached photo or gender', () => {
  const result = mergeProfileAvatarFields({id:'a',avatar_url:null,avatar_gender:null},{id:'a',avatar_url:'old.jpg',avatar_gender:'female'});
  assert.equal(result.avatar_url,null);
  assert.equal(result.avatar_gender,null);
});
test('legacy gender choice leaves a removed photo empty', () => {
  const result = mergeProfileAvatarFields({id:'a',avatar_url:null,avatar_gender:'female'},{id:'a',avatar_url:'old.jpg'});
  assert.equal(resolveAvatarUrl({avatarUrl:result.avatar_url,avatarGender:result.avatar_gender}),'');
});
test('new photos replace old photos and missing legacy fields remain supported', () => {
  assert.equal(mergeProfileAvatarFields({id:'a',avatar_url:'new.jpg'},{id:'a',avatar_url:'old.jpg'}).avatar_url,'new.jpg');
  assert.equal(mergeProfileAvatarFields({id:'a'},{id:'a',avatar_url:'old.jpg'}).avatar_url,'old.jpg');
  assert.equal(mergeProfileAvatarFields({id:'b'},{id:'a',avatar_url:'old.jpg'}).avatar_url,undefined);
});
const {findPublicEventForVideo} = load('lib/public-event-link.ts');
function client(result) {
  const calls=[];
  const query={};
  for(const method of ['select','eq','in','order','limit']) query[method]=(...args)=>{calls.push([method,...args]);return query;};
  query.maybeSingle=async()=>result;
  return {db:{from(name){assert.equal(name,'events');return query;}},calls};
}
test('old video links resolve to the public event containing all inventory', async()=>{
  const {db,calls}=client({data:{id:'event-1'},error:null});
  assert.equal(await findPublicEventForVideo(db,'video-1'),'event-1');
  assert.ok(calls.some(c=>c[0]==='eq' && c[1]==='video_id' && c[2]==='video-1'));
  assert.ok(calls.some(c=>c[0]==='eq' && c[1]==='is_public' && c[2]===true));
});
test('video-only shares retain the video page', async()=>{
  assert.equal(await findPublicEventForVideo(client({data:null,error:null}).db,'video-1'),null);
});
test('lookup failures are not misrepresented as an event with no inventory', async()=>{
  await assert.rejects(findPublicEventForVideo(client({data:null,error:new Error('Network unavailable')}).db,'video-1'),/Network unavailable/);
});

for (const tab of ['tabs','tabsbusiness']) {
  test(`${tab}: failed profile saves never broadcast an unsaved photo`, async () => {
    const source=fs.readFileSync(`app/(${tab})/profile.tsx`,'utf8');
    const ast=ts.createSourceFile('profile.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    let declaration;
    function visit(n){
      if(ts.isVariableStatement(n) && n.declarationList.declarations.some(d=>d.name.getText(ast)==='pickAndUploadAvatar')) declaration=n.getText(ast);
      ts.forEachChild(n,visit);
    }
    visit(ast);
    const alerts=[]; let broadcast=false;
    const context={useCallback:fn=>fn,authUser:{id:'user'},updateProfile:async()=>({error:new Error('Photo save denied')}),
      ImagePicker:{requestMediaLibraryPermissionsAsync:async()=>({granted:true}),MediaTypeOptions:{Images:'images'},launchImageLibraryAsync:async()=>({canceled:false,assets:[{uri:'file:///photo.jpg'}]})},
      uploadImageToSupabase:async()=> 'https://example.com/new.jpg',setIsUploadingAvatar(){},setAvatarGender(){},
      useVideoStore:{getState:()=>({syncUserProfile(){broadcast=true;}})},Alert:{alert:(...args)=>alerts.push(args)},
    };
    context.logger = require('./logger-fixture.cjs');
    vm.createContext(context);
    vm.runInContext(ts.transpileModule(declaration+'\nglobalThis.pick = pickAndUploadAvatar;', {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);
    await context.pick();
    assert.equal(alerts[0][0],'Upload Failed');
    assert.equal(broadcast,false);
  });
}
