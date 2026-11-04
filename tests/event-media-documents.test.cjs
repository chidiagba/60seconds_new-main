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
