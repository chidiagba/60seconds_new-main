const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, context = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText, {exports, ...context});
  return exports;
}
const avatar = load('utils/avatar.ts');
const venue = load('utils/venue-location.ts');
test('only real uploaded photos appear; legacy portraits, gender and missing photos stay empty', () => {
  assert.equal(avatar.resolveAvatarUrl({avatarUrl:'https://example.com/photo.jpg'}),'https://example.com/photo.jpg');
  for (const avatarUrl of [null, '', '👨', 'https://via.placeholder.com/150', 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150']) {
    assert.equal(avatar.resolveAvatarUrl({avatarUrl, avatarGender:'male', fallbackUrl:'https://example.com/fallback.jpg'}),'');
  }
});
test('saved WKT and PostgreSQL points decode longitude first without swapping the venue', () => {
  for (const point of ['POINT(3.35 6.60)', '(3.35,6.60)']) {
    const result=venue.videoVenueCoordinates({location_coordinates:point});
    assert.equal(result.latitude,6.6);
    assert.equal(result.longitude,3.35);
  }
});
test('missing, zero and invalid coordinates cannot become a distance to a fake pin', () => {
  for (const value of [{latitude:null,longitude:null},{latitude:0,longitude:0},{latitude:91,longitude:3},{latitude:'',longitude:3}]) assert.equal(venue.venueCoordinates(value),null);
  assert.ok(venue.venueCoordinates({latitude:0,longitude:3}));
});
function routing(response) {
  let requests=0;
  const location=load('utils/location.ts', {
    require:name=>name==='./venue-location'?venue:name==='react-native'?{Platform:{OS:'ios'}}:{},
    AbortSignal:{timeout:()=>undefined},
    fetch:async()=>{requests++;return {ok:true,json:async()=>response};},
  });
  return {...location, requests:()=>requests};
}
test('road distance uses the stored venue pin and route metres, with useful short-distance precision', async () => {
  const f=routing({code:'Ok',routes:[{distance:2450}],waypoints:[{distance:5},{distance:10}]});
  assert.equal(await f.calculateRoadDistance(6.65,3.4,6.6,3.35),2.45);
  assert.equal(f.formatDistance(2.45),'2.5 km');
});
test('unavailable routes and road snaps far from the venue never masquerade as driving distance', async () => {
  for(const response of [{code:'NoRoute'}, {code:'Ok',routes:[{distance:4556000}],waypoints:[{distance:2},{distance:10000}]}]) {
    const f=routing(response);
    assert.ok(Number.isNaN(await f.calculateRoadDistance(6.65,3.4,6.6,3.35)));
    assert.equal(f.formatDistance(NaN),'');
  }
});
test('an invalid destination makes no routing request',async()=>{
  const f=routing({});
  assert.ok(Number.isNaN(await f.calculateRoadDistance(6.65,3.4,0,0)));
  assert.equal(f.requests(),0);
});
test('a saved pin is normalized into the exact coordinates consumed by every feed mapper', async () => {
  const source=ts.createSourceFile('database.ts',fs.readFileSync('lib/database.ts','utf8'),ts.ScriptTarget.Latest,true);
  let method;
  function visit(n) {if(ts.isMethodDeclaration(n)&&n.name.getText(source)==='normalizeVideoRecord')method=n.getText(source);ts.forEachChild(n,visit);}
  visit(source);
  const context={videoVenueCoordinates:venue.videoVenueCoordinates};
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(`globalThis.service={${method}, normalizeMediaUrl:async url=>url};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);
  const row=await context.service.normalizeVideoRecord({location_coordinates:'(3.35,6.6)',location_name:'Venue, Ikeja, Nigeria'});
  assert.equal(row.location_latitude,6.6);
  assert.equal(row.location_longitude,3.35);
  assert.equal(row.location_name,'Venue, Ikeja, Nigeria');
});
test('shared avatar follows the current profile immediately and clears on removal or load failure', () => {
  let user={id:'owner',avatar:'https://example.com/new.jpg'},failed=null;
  const component=load('components/AvatarImage.tsx', {require:name=>{
    if(name==='react')return {default:{createElement:(type,props)=>({type,props})},useState:()=>[failed,v=>{failed=v;}]};
    if(name==='expo-image')return {Image:'Image'};
    if(name==='@/store/auth-store')return {useAuthStore:selector=>selector({user})};
    return avatar;
  }}).default;
  let rendered=component({uri:'https://example.com/old.jpg',userId:'owner'});
  assert.equal(rendered.props.source.uri,user.avatar);
  rendered.props.onError({});
  assert.equal(component({uri:'https://example.com/old.jpg',userId:'owner'}).props.source,null);
  user={id:'owner',avatar:''};
  assert.equal(component({uri:'https://example.com/old.jpg',userId:'owner'}).props.source,null);
});
