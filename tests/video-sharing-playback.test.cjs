const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function functions(file, names, context) {
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  function visit(n) {
    if (ts.isVariableStatement(n) && n.declarationList.declarations.some(d => names.includes(d.name.getText(ast)))) found.push(n.getText(ast));
    ts.forEachChild(n, visit);
  }
  visit(ast);
  assert.equal(found.length, names.length);
  context.logger = require('./logger-fixture.cjs');
    vm.createContext(context);
  vm.runInContext(ts.transpileModule(found.join('\n') + '\nglobalThis.api = {' + names.join(',') + '};', {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText, context);
  return context.api;
}
test('watermark playback clock updates throughout the clip, including seeks and loops without tags', () => {
  let seconds;
  const {handlePlaybackStatusUpdate:update} = functions('components/VideoPlayer.tsx', ['handlePlaybackStatusUpdate'], {
    setIsLoading(){}, canPlay:true, taggedUsers:[], lastProgressSecondRef:{current:-1},setCurrentTime:value=>seconds=value,
  });
  for (const position of [0,3750,4000,8250,0]) {
    update({isLoaded:true,positionMillis:position,durationMillis:10000,isBuffering:false});
    assert.equal(seconds,position/1000);
  }
});
for (const destination of ['instagram','tiktok','twitter']) {
  test(`${destination} shares immediately after validation without a confirmation`, async () => {
    const calls=[];
    const context={Platform:{OS:'ios'},activeShareSession:false,isPreparingVideo:false,
      console:{log(){},warn(){}},isCancelRequestedRef:{current:false},isMountedRef:{current:true},
      updatePreparingState(){},setPreparationState(){},setPreparedShare(){},
      prepareVideoForShare:async()=>({uri:'file:///video.mp4',mimeType:'video/mp4'}),
      FileSystem:{getInfoAsync:async()=>({exists:true,size:5000})},
      continuePreparedShare:async prepared=>calls.push(prepared), DESTINATION_LABELS:{},
      Alert:{alert(){assert.fail('Unexpected error');}},isLikelyShareCancelled:()=>false,
    };
    await functions('components/ShareModal.tsx',['beginVideoShare'],context).beginVideoShare(destination);
    assert.equal(calls.length,1);
    assert.equal(calls[0].destination,destination);
    assert.equal(context.activeShareSession,false);
  });
}
test('closing while download is preparing prevents a later share', async () => {
  let shared=false;
  const context={Platform:{OS:'ios'},activeShareSession:false,isPreparingVideo:false,
    console:{log(){},warn(){}},isCancelRequestedRef:{current:false},isMountedRef:{current:true},
    updatePreparingState(){},setPreparationState(){},setPreparedShare(){},
    prepareVideoForShare:async()=>{context.isCancelRequestedRef.current=true; return {uri:'file:///video.mp4'};},
    continuePreparedShare:async()=>{shared=true;},DESTINATION_LABELS:{},isLikelyShareCancelled:()=>false,
  };
  await functions('components/ShareModal.tsx',['beginVideoShare'],context).beginVideoShare('instagram');
  assert.equal(shared,false);
  assert.equal(context.activeShareSession,false);
});
for (const mode of ['direct','unavailable','cancelled','tiktok']) {
  test(`native sharing uses the correct route: ${mode}`, async () => {
    const calls=[];
    const context={Platform:{OS:'android'},isCancelRequestedRef:{current:false},isMountedRef:{current:true},
      resolveShareSocialTarget:destination=>destination==='tiktok'?null:'instagram',
      ShareOpen:{shareSingle:async options=>{calls.push('direct'); if(mode==='unavailable'||mode==='cancelled') throw new Error(mode); return {success:true};}},
      openSystemShareSheet:async prepared=>{calls.push('system'); assert.equal(prepared.uri,'file:///video.mp4');},
      isLikelyShareCancelled:error=>error.message==='cancelled',finishShare:()=>calls.push('finished'),shareMessage:'caption',
    };
    await functions('components/ShareModal.tsx',['continuePreparedShare'],context).continuePreparedShare({destination:mode==='tiktok'?'tiktok':'instagram',uri:'file:///video.mp4',mimeType:'video/mp4'});
    assert.deepEqual(calls,mode==='direct'?['direct','finished']:mode==='unavailable'?['direct','system']:mode==='cancelled'?['direct']:['system']);
  });
}

for (const destination of ['instagram','facebook','whatsapp']) {
  test(`iOS ${destination} sends the local video through the share extension`, async () => {
    const calls=[];
    const context={Platform:{OS:'ios'},isCancelRequestedRef:{current:false},isMountedRef:{current:true},
      resolveShareSocialTarget:()=>destination, ShareOpen:{shareSingle(){assert.fail('Unsupported iOS file handler');}},
      openSystemShareSheet:async prepared=>calls.push(prepared.uri),
    };
    await functions('components/ShareModal.tsx',['continuePreparedShare'],context).continuePreparedShare({destination,uri:'file:///video.mp4',mimeType:'video/mp4'});
    assert.deepEqual(calls,['file:///video.mp4']);
  });
}
for (const destination of ['whatsapp','instagram','tiktok','facebook','twitter','generic']) {
  test(`iOS ${destination} share sheet receives the exported MP4 as a file attachment`, async () => {
    const calls=[];
    const context={Platform:{OS:'ios'},isCancelRequestedRef:{current:false},isMountedRef:{current:true},
      resolveShareSocialTarget:()=>destination,ShareOpen:{shareSingle(){assert.fail('iOS must pass the file through its system share sheet');}},
      openSystemShareSheet:async prepared=>calls.push({uri:prepared.uri,mimeType:prepared.mimeType}),
    };
    await functions('components/ShareModal.tsx',['continuePreparedShare'],context).continuePreparedShare({
      destination,uri:'file:///cache/watermarked.mp4',mimeType:'video/mp4',
    });
    assert.deepEqual(calls,[{uri:'file:///cache/watermarked.mp4',mimeType:'video/mp4'}]);
  });
}
for (const platform of ['android']) {
  test(`${platform}: WhatsApp attaches the video even when an event has a booking link`, async () => {
    const destinations=[];
    const context={Platform:{OS:platform},eventId:'event-1',shareMessage:'Book here: https://example.com/event-1',
      handleHapticFeedback(){},beginVideoShare:async target=>destinations.push(target),
    };
    await functions('components/ShareModal.tsx',['handleShareToWhatsApp'],context).handleShareToWhatsApp();
    assert.deepEqual(destinations,['whatsapp']);
  });
  for (const destination of ['twitter','tiktok']) {
    test(`${platform}: ${destination} receives a video attachment through the system sheet`, async () => {
      let attached;
      const context={Platform:{OS:platform},isCancelRequestedRef:{current:false},isMountedRef:{current:true},
        resolveShareSocialTarget:()=>destination,ShareOpen:{shareSingle(){assert.fail('Unsupported direct target');}},
        openSystemShareSheet:async prepared=>attached=prepared.uri,
      };
      await functions('components/ShareModal.tsx',['continuePreparedShare'],context).continuePreparedShare({destination,uri:'file:///video.mp4',mimeType:'video/mp4'});
      assert.equal(attached,'file:///video.mp4');
    });
  }
}
test('Android falls back to the attachment sheet when a destination is not installed', async () => {
  const calls=[];
  const context={Platform:{OS:'android'},isCancelRequestedRef:{current:false},isMountedRef:{current:true},
    resolveShareSocialTarget:()=> 'facebook',
    ShareOpen:{isPackageInstalled:async name=>{assert.equal(name,'com.facebook.katana');return {isInstalled:false};},shareSingle(){assert.fail('Must not open market or web fallback');}},
    openSystemShareSheet:async prepared=>calls.push(prepared.uri),
  };
  await functions('components/ShareModal.tsx',['continuePreparedShare'],context).continuePreparedShare({destination:'facebook',uri:'file:///video.mp4',mimeType:'video/mp4'});
  assert.deepEqual(calls,['file:///video.mp4']);
});
for (const platform of ['android']) {
  test(`${platform}: native share sheet receives the video file and MIME type`, async () => {
    let payload; let finished=false;
    const context={Platform:{OS:platform},video:{eventName:'Event'},shareMessage:'Booking link',xShareMessage:'Short booking link',
      ShareOpen:{open:async options=>{payload=options;return {success:true};}},
      isLikelyShareCancelled:()=>false,finishShare:()=>{finished=true;},
    };
    await functions('components/ShareModal.tsx',['openSystemShareSheet'],context).openSystemShareSheet({destination:'tiktok',uri:'file:///video.mp4',mimeType:'video/mp4'});
    assert.equal(payload.url,'file:///video.mp4');
    assert.equal(payload.type,'video/mp4');
    assert.equal(payload.message,undefined);
    assert.equal(finished,true);
  });
  test(`${platform}: direct WhatsApp receives the attachment alongside the caption`, async () => {
    let payload;
    const context={Platform:{OS:platform},isCancelRequestedRef:{current:false},isMountedRef:{current:true},
      resolveShareSocialTarget:()=> 'whatsapp',shareMessage:'Booking link',
      ShareOpen:{shareSingle:async options=>{payload=options;return {success:true};}},
      isLikelyShareCancelled:()=>false,finishShare(){},
    };
    await functions('components/ShareModal.tsx',['continuePreparedShare'],context).continuePreparedShare({destination:'whatsapp',uri:'file:///video.mp4',mimeType:'video/mp4'});
    assert.equal(payload.url,'file:///video.mp4');
    assert.equal(payload.type,'video/mp4');
    assert.equal(payload.message,'Booking link');
  });
}

test('sharing burns the creator watermark before handing the file to any destination', async () => {
  const original = {uri:'file:///original.mp4',mimeType:'video/mp4'};
  const branded = {uri:'file:///branded.mp4',mimeType:'video/mp4',outputType:'mp4',applied:true};
  const api = functions('components/ShareModal.tsx', ['prepareVideoForShare'], {
    ensureOriginalVideoCached:async()=>original,video:{id:'video-1',user:{username:'creator'}},
    FileSystem:{getInfoAsync:async()=>({exists:true,size:5000})},
    videoWatermarkService:{prepareExport:async(uri,username,id)=>{
      assert.equal(uri,original.uri);assert.equal(username,'creator');assert.equal(id,'video-1');return branded;
    }},
  });
  assert.equal(await api.prepareVideoForShare(), branded);
});

test('sharing refuses a non-MP4, non-local, or unwatermarked export', async () => {
  for (const invalid of [
    {uri:'https://cdn.example/video.mp4',mimeType:'video/mp4',outputType:'mp4',applied:true},
    {uri:'file:///video.mov',mimeType:'video/quicktime',outputType:'mov',applied:true},
    {uri:'file:///video.mp4',mimeType:'video/mp4',outputType:'mp4',applied:false},
  ]) {
    const api = functions('components/ShareModal.tsx', ['prepareVideoForShare'], {
      ensureOriginalVideoCached:async()=>({uri:'file:///original.mp4'}),
      video:{id:'video-1',user:{username:'creator'}},
      FileSystem:{getInfoAsync:async()=>({exists:true,size:5000})},
      videoWatermarkService:{prepareExport:async()=>invalid},
    });
    await assert.rejects(api.prepareVideoForShare(),/local MP4 video/);
  }
});

test('manual playback can start from paused while automatic feeds obey their parent pause state',()=>{
 for(const [autoplay,paused,isPlaying,appState,isFocused,expected] of [
  [false,true,true,'active',true,true], [false,true,false,'active',true,false],
  [true,true,true,'active',true,false], [true,false,false,'active',true,true],
  [false,true,true,'background',true,false], [true,false,true,'active',false,false],
 ]) {
  const {canPlay}=functions('components/VideoPlayer.tsx',['canPlay'],{autoplay,paused,isPlaying,appState,isFocused});
  assert.equal(canPlay,expected);
 }
});
for (const destination of ['generic','instagram','whatsapp','tiktok']) {
  test(`${destination}: a failed watermark export cannot share the original`, async()=>{
    let shared=false,alerted=false;
    const context={Platform:{OS:'ios'},activeShareSession:false,isPreparingVideo:false,
      isCancelRequestedRef:{current:false},isMountedRef:{current:true},updatePreparingState(){},DESTINATION_LABELS:{},
      prepareVideoForShare:async()=>{throw new Error('watermark failed');},
      continuePreparedShare:async()=>{shared=true;},isLikelyShareCancelled:()=>false,Alert:{alert(){alerted=true;}},
    };
    await functions('components/ShareModal.tsx',['beginVideoShare'],context).beginVideoShare(destination);
    assert.equal(shared,false);assert.equal(alerted,true);assert.equal(context.activeShareSession,false);
  });
}
for(const fail of [false,true]) {
  test(`saving to Photos ${fail?'blocks on watermark failure':'uses only the burned export'}`,async()=>{
    let saved=null;
    const context={Platform:{OS:'android'},activeShareSession:false,isPreparingVideo:false,
      isCancelRequestedRef:{current:false},isMountedRef:{current:true},updatePreparingState(){},
      MediaLibrary:{requestPermissionsAsync:async()=>({granted:true}),saveToLibraryAsync:async uri=>{saved=uri;}},
      prepareVideoForShare:async()=>{if(fail)throw new Error('encoder failed');return {uri:'file:///watermarked.mp4'};},Alert:{alert(){}},
    };
    await functions('components/ShareModal.tsx',['handleSaveVideo'],context).handleSaveVideo();
    assert.equal(saved,fail?null:'file:///watermarked.mp4');assert.equal(context.activeShareSession,false);
  });
}
