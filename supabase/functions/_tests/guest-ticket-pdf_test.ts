import {createGuestTicketPdf} from '../_shared/guest-ticket-pdf.ts';
import {PDFDocument} from 'npm:pdf-lib@1.17.1';
Deno.test('guest ticket PDF is a real multi-page branded document, not an image attachment',async()=>{
 const base={ticket_title:'VIP — Café Étoile',event_name:'60Seconds Night',quantity:1,location_name:'Lagos',currency:'NGN',total_price:1040};
 const encoded=await createGuestTicketPdf([{...base,id:'one',qr_code_data:'TICKET:one'},{...base,id:'two',qr_code_data:'PRODUCT:two'}],'120','https://example.supabase.co');
 const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
 if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw new Error('Invalid PDF');
 const pdf=await PDFDocument.load(bytes);if(pdf.getPageCount()!==2)throw new Error('Missing ticket pages');
 if(!pdf.getTitle()?.includes('60Seconds'))throw new Error('Missing branding');
});
Deno.test('PDF generation rejects absent or invalid receipt QR values',async()=>{
 for(const tickets of [[],[{ticket_title:'Ticket',qr_code_data:''}]]){
  let rejected=false;try{await createGuestTicketPdf(tickets,'120','https://example.supabase.co');}catch{rejected=true;}
  if(!rejected)throw new Error('Invalid receipt accepted');
 }
});
