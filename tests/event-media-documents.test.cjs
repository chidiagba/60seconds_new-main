const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');
function load(file){const exports={}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,{exports,require,Buffer,Error,Date});return exports;}
const {ticketDocumentHtml,receiptQrImage,ticketDocumentFileName}=load('utils/ticket-document.ts');
const ticket={ticket_title:'Entry <script>alert(1)</script>',event_name:'Evening & Friends',order_number:'ORDER-1',qr_code_data:'TICKET:one',quantity:1};
test('printed tickets include their event flyer and escape user-provided text',()=>{
 const html=ticketDocumentHtml(ticket,receiptQrImage(ticket.qr_code_data),'https://example.test/flyer.png');
 assert.match(html,/class="flyer" src="https:\/\/example.test\/flyer.png"/);
 assert.match(html,/Evening &amp; Friends/);
 assert.match(html,/&lt;script&gt;/);
 assert.doesNotMatch(html,/<script>/);
});
test('ticket and product documents have distinct QR images under the same order number',()=>{
 const ticketQr=receiptQrImage('TICKET:one'); const productQr=receiptQrImage('PRODUCT:two');
 assert.notEqual(ticketQr,productQr);
 assert.match(Buffer.from(ticketQr.split(',')[1],'base64').toString(),/viewBox="0 0/);
 const html=ticketDocumentHtml({...ticket,qr_code_data:'PRODUCT:two'},productQr);
 assert.match(html,/ORDER-1/);
 assert.throws(()=>receiptQrImage(''),/receipt QR/);
});
test('unsafe image protocols cannot enter printable tickets',()=>{
 const html=ticketDocumentHtml(ticket,receiptQrImage(ticket.qr_code_data),'javascript:alert(1)');
 assert.doesNotMatch(html,/javascript:/);
 assert.throws(()=>ticketDocumentHtml(ticket,'javascript:bad'),/valid receipt QR/);
});
const {isEventClosed}=load('utils/event-status.ts');
test('Deals cannot sell an ended event even when its stored status is still open',()=>{
 assert.equal(isEventClosed({status:'open',endDate:'2026-01-01'},new Date('2026-10-27')),true);
 assert.equal(isEventClosed({status:'published',endDate:'2027-01-01'},new Date('2026-10-27')),false);
 assert.equal(isEventClosed({status:'cancelled',endDate:'2027-01-01'},new Date('2026-10-27')),true);
});

test('separate receipts in one order never reuse the same cached PDF',()=>{
 assert.notEqual(ticketDocumentFileName({id:'ticket-one',order_number:'ORDER-1'}),ticketDocumentFileName({id:'ticket-two',order_number:'ORDER-1'}));
 assert.notEqual(ticketDocumentFileName({id:'ticket-one',order_number:'ORDER-1'}),ticketDocumentFileName({id:'product-one',order_number:'ORDER-1'}));
});
const {loadTicketSellers,ticketSeller}=load('lib/ticket-seller.ts');
test('ticket PDFs include seller identity and business contacts beside the actual receipt QR',()=>{
 const seller=ticketSeller({business_name:'Lekki & Co',username:'lekki',business_address:'10 Main Street',business_phone:'+234 123',business_website:'https://example.test',email:'private@example.test'});
 const html=ticketDocumentHtml({...ticket,seller},receiptQrImage(ticket.qr_code_data));
 for(const value of ['Sold by','Lekki &amp; Co','@lekki','10 Main Street','+234 123','https://example.test','Receipt QR code'])assert.ok(html.includes(value));
 assert.doesNotMatch(html,/private@example.test/);
 assert.match(ticketDocumentFileName({id:'one',order_number:'ORDER-1'}),/seller-v6/);
});
test('ticket seller lookup batches owners and supports profile schemas without optional contact columns',async()=>{
 let calls=0;
 const db={from:()=>({select:fields=>({in:async(column,ids)=>{
  calls++;assert.equal(ids.length,1);
  if(fields.includes('business_phone'))return {error:{code:'42703'}};
  return {data:[{id:'seller',business_name:'Verified business',username:'seller',location_city:'Lagos'}]};
 }})})};
 const sellers=await loadTicketSellers(db,['seller','seller']);
 assert.equal(calls,2);assert.equal(sellers.get('seller').name,'Verified business');assert.equal(sellers.get('seller').address,'Lagos');
});
test('missing business details are explicit and seller lookup failures are retryable',async()=>{
 assert.equal(ticketSeller({}).name,'Business details unavailable');
 await assert.rejects(loadTicketSellers({from:()=>({select:()=>({in:async()=>({error:{code:'42501'}})})})},['seller']),/try again/);
});
