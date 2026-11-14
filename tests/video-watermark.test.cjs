const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, requireStub) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:requireStub});
  return exports;
}
const layout=load('utils/watermark-layout.ts');
function service(options={}) {
  const files=new Set(['file:///source.mp4','file:///logo.png','file:///brand.png','file:///export.mp4','file:///changed.mp4']);
  const calls=[];
  const native={createWatermarkImage:async(logo,username)=>{files.add('file:///brand.png');calls.push(['brand',logo,username]);return 'file:///brand.png';},exportBrandedVideo:async(...args)=>{calls.push(['export',...args]);if(options.fail)throw new Error('encoder failed');const result=options.original?'file:///source.mp4':'file:///export.mp4';files.add(result);return result;}};
  const module=load('utils/video-watermark.ts',name=>{
    if(name==='./watermark-layout')return layout;
    if(name==='react-native')return {Platform:{OS:options.platform||'ios'},NativeModules:{}};
    if(name==='native-video-watermark')return {default:options.missing?{}:native};
    if(name==='expo-asset')return {Asset:{fromModule:()=>({downloadAsync:async()=>{},localUri:'file:///logo.png'})}};
    if(name==='expo-file-system/legacy')return {cacheDirectory:'file:///cache/',getInfoAsync:async uri=>({exists:files.has(uri),size:4096}),copyAsync:async({to})=>files.add(to),deleteAsync:async uri=>files.delete(uri)};
    if(name==='@/lib/logger')return {logger:require('./logger-fixture.cjs')};
    return 1;
  });
  return {api:module.videoWatermarkService,calls};
}
test('watermark stays fixed in the bottom-right corner for the full video',()=>{
  for(const seconds of [0,3.75,4,8,16,74.8]) {
    const point=layout.watermarkCorner(seconds);assert.equal(point.x,1);assert.equal(point.y,1);
  }
});
test('handles are required, normalized once, and reject line/control injection',()=>{
  assert.equal(layout.watermarkUsername(' @@lekki_street_boy '),'@lekki_street_boy');
  for(const value of ['', '@', 'user\nname', 'user name'])assert.throws(()=>layout.watermarkUsername(value));
});
for(const platform of ['android','ios']) {
  test(`${platform}: export burns a full branded image using the original video`,async()=>{
    const f=service({platform});const result=await f.api.addWatermarkToVideo('file:///source.mp4',{username:'creator'});
    assert.equal(result.applied,true);assert.equal(result.uri,'file:///export.mp4');
    assert.deepEqual(f.calls[0],['brand','file:///logo.png','@creator']);
    assert.equal(f.calls[1][1],'file:///source.mp4');assert.equal(f.calls[1][2],'file:///brand.png');
    assert.equal(f.calls[1][4],0.72);assert.equal(f.calls[1][5],0.28);
  });
  test(`${platform}: unavailable encoders never return the source, even with legacy fallback flags`,async()=>{
    const f=service({platform,fail:true});
    await assert.rejects(f.api.addWatermarkToVideo('file:///source.mp4',{username:'creator',allowFallback:true}),/Watermark failed/);
  });
}
test('an old native binary cannot silently export the obsolete end-logo watermark',async()=>{
  await assert.rejects(service({missing:true}).api.addWatermarkToVideo('file:///source.mp4',{username:'creator'}),/binary must be updated/);
});
test('a native exporter returning the original source is rejected',async()=>{
  await assert.rejects(service({original:true}).api.addWatermarkToVideo('file:///source.mp4',{username:'creator'}),/Watermark failed/);
});
test('new exports are cached by version, creator and source; concurrent requests share work',async()=>{
  const f=service();
  const [a,b]=await Promise.all([f.api.prepareExport('file:///source.mp4','creator','video'),f.api.prepareExport('file:///source.mp4','creator','video')]);
  assert.equal(a.uri,b.uri);assert.match(a.uri,/wm_branded_v3_fixed_bottom_right_cached_/);
  await f.api.prepareExport('file:///source.mp4','creator','video');
  assert.equal(f.calls.filter(call=>call[0]==='export').length,1);
  const changed=await f.api.prepareExport('file:///changed.mp4','creator','video');
  const renamed=await f.api.prepareExport('file:///source.mp4','renamed','video');
  assert.notEqual(changed.uri,a.uri);assert.notEqual(renamed.uri,a.uri);
});
test('FFmpeg export burns a fixed bottom-right watermark without resizing video',()=>{
  const filter=layout.watermarkFFmpegFilter(300);
  assert.match(filter,/\[1:v\]scale=300:-1/);assert.match(filter,/main_w-overlay_w/);assert.match(filter,/main_h-overlay_h/);
  assert.doesNotMatch(filter,/enable=|gte\(t|\[0:v\]scale/);
});

test('iOS exporter requires MP4 output and fixes the baked watermark at bottom-right',()=>{
  const source=fs.readFileSync('modules/native-video-watermark/ios/NativeVideoWatermarkModule.swift','utf8');
  assert.match(source,/supportedFileTypes\.contains\(\.mp4\)/);
  assert.match(source,/let outputFileType: AVFileType = \.mp4/);
  assert.match(source,/extent\.maxX - logoSize\.width - margin/);
  assert.match(source,/extent\.minY \+ margin/);
  assert.doesNotMatch(source,/outputExtension = "mov"/);
});
