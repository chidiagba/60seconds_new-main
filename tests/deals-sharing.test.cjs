const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');
function load(file,requireModule,globals={}) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:requireModule,...globals});
 return exports;
}
for (const platform of ['android','ios','web']) {
 test(`${platform}: event webpage shares preserve the public event link and details`,async()=>{
  const calls=[];
  const mod=load('lib/share-webpage.ts',name=>name==='react-native'?{Platform:{OS:platform},Share:{dismissedAction:'dismissed',share:async data=>{calls.push(data);return {action:'shared'};}}}:{setStringAsync:async url=>calls.push(url)},
   {navigator:{share:async data=>calls.push(data)}});
  const page={title:'Test Night',url:'https://events.60secondsapp.io/event-1',username:'@business',location:'Lagos',date:'19 Dec 2026',description:'Book a table'};
  assert.equal(await mod.shareWebpage(page),true);
  assert.equal(calls[0].url,page.url);
  const message=calls[0].message || calls[0].text;
  for(const text of ['Test Night','@business','Lagos','19 Dec 2026','Book a table',page.url])assert.ok(message.includes(text));
 });
}
test('cancelling native sharing is not counted as a share',async()=>{
 const mod=load('lib/share-webpage.ts',name=>name==='react-native'?{Platform:{OS:'ios'},Share:{dismissedAction:'dismissed',share:async()=>({action:'dismissed'})}}:{});
 assert.equal(await mod.shareWebpage({title:'Event',url:'https://events.60secondsapp.io/e'}),false);
});
test('web fallback copies the public URL; cancellation does not copy unexpectedly',async()=>{
 let copied='';
 const modules=name=>name==='react-native'?{Platform:{OS:'web'}}:{setStringAsync:async url=>{copied=url;}};
 let mod=load('lib/share-webpage.ts',modules,{navigator:{}});
 assert.equal(await mod.shareWebpage({title:'Event',url:'https://events.60secondsapp.io/e'}),true);
 assert.equal(copied,'https://events.60secondsapp.io/e');copied='';
 mod=load('lib/share-webpage.ts',modules,{navigator:{share:async()=>{const e=new Error();e.name='AbortError';throw e;}}});
 assert.equal(await mod.shareWebpage({title:'Event',url:'https://events.60secondsapp.io/e'}),false);
 assert.equal(copied,'');
});
test('Deals forwards pagination to the endpoint and hides database errors',async()=>{
 let request;
 const mod=load('lib/event-queries.ts',name=>name.includes('logger')?{logger:{}}:{supabase:{functions:{invoke:async(name,options)=>{request={name,...options};return {data:{events:[{id:'table-only',table_count:1}],hasMore:true}};}}}});
 const result=await mod.EventQueries.getDealsEvents(60,120);
 assert.equal(request.name,'guest-event');assert.equal(request.body.action,'deals');assert.equal(request.body.offset,120);
 assert.equal(result.events[0].id,'table-only');assert.equal(result.hasMore,true);
 const failed=load('lib/event-queries.ts',name=>name.includes('logger')?{logger:{}}:{supabase:{functions:{invoke:async()=>({error:{message:'PGRST201: internal relationship detail'}})}}});
 assert.equal((await failed.EventQueries.getDealsEvents()).error,'Unable to load deals. Please try again.');
});
function guestHandler(db) {
 let handler;
 const source=fs.readFileSync('supabase/functions/guest-event/index.ts','utf8').replace(/^import .*;\n/gm,'');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,{
  Deno:{env:{get:()=>''},serve:fn=>{handler=fn;}},createClient:()=>db,
  corsForRequest:()=>({}),Response,console:{error(){}},
 });
 return body=>handler(new Request('https://example.test/guest-event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
}
test('Deals endpoint validates pages before any database access',async()=>{
 const run=guestHandler({rpc(){throw new Error('Must not query');}});
 for(const input of [{limit:0},{limit:101},{offset:-1},{offset:1.5},{limit:'60'}])assert.equal((await run({action:'deals',...input})).status,400);
});
test('Deals endpoint returns public inventory without creating any orders',async()=>{
 const calls=[];
 const run=guestHandler({rpc:async(name,args)=>{calls.push({name,args});return {data:{events:[{id:'public-event',table_count:1}],hasMore:false}};}});
 const response=await run({action:'deals',limit:20,offset:40});
 assert.equal(response.status,200);assert.equal((await response.json()).events[0].id,'public-event');
 assert.equal(calls.length,1);assert.equal(calls[0].name,'public_deals_events');
 assert.equal(calls[0].args.page_size,20);assert.equal(calls[0].args.page_offset,40);
});
