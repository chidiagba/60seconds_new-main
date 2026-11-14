const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const source=fs.readFileSync('components/chat/MessageNotificationBridge.tsx','utf8');
const ast=ts.createSourceFile('bridge.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const declarations=[];
function visit(node){if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>['handleNotificationRoute','routeResponse'].includes(d.name.getText(ast)))) declarations.push(node.getText(ast));ts.forEachChild(node,visit);}
visit(ast);
function fixture(){const calls=[];let cleared=0;const context={active:true,handledResponse:{current:null},router:{push:r=>calls.push(r)},NotificationsModule:{clearLastNotificationResponse(){cleared++;}}};vm.createContext(context);vm.runInContext(ts.transpileModule(declarations.join('\n')+'\nglobalThis.route=routeResponse;',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);return {calls,context,cleared:()=>cleared,response:(id,data)=>context.route({notification:{request:{identifier:id,content:{data}}}})};}
test('follower tap opens the follower profile and duplicate responses are ignored',()=>{
 const f=fixture();f.response('follow-1',{kind:'follower',userId:'actor'});f.response('follow-1',{kind:'follower',userId:'actor'});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].pathname,'/profile');assert.equal(f.calls[0].params.userId,'actor');assert.equal(f.cleared(),1);
});
test('direct and group notification taps open their relevant chat',()=>{
 const f=fixture();f.response('direct-1',{kind:'message',chatId:'chat-1',otherUserId:'sender'});f.response('group-1',{kind:'message',chatType:'group',chatId:'group-1'});
 assert.equal(f.calls[0].pathname,'/chat/[chatId]');assert.equal(f.calls[0].params.chatId,'chat-1');assert.equal(f.calls[0].params.otherUserId,'sender');
 assert.equal(f.calls[1].params.chatId,'group-1');assert.equal(f.calls[1].params.type,'group');
});
test('a pending response cannot navigate after logout or unmount cleanup',()=>{
 const f=fixture();f.context.active=false;f.response('late',{kind:'message',chatId:'chat'});assert.equal(f.calls.length,0);
});

test('purchase completion notification opens the fulfilled order',()=>{const f=fixture();f.response('order-1',{kind:'order',orderId:'paid-order'});assert.equal(f.calls[0].pathname,'/order/[id]');assert.equal(f.calls[0].params.id,'paid-order');});
