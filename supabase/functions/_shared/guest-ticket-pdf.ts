import { PDFDocument, rgb, type PDFFont } from 'npm:pdf-lib@1.17.1';
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';
import QRCode from 'npm:qrcode@1.5.4';
import { notoSansBase64 } from './ticket-assets/noto-sans.ts';
import type { TicketSeller } from '../../../lib/ticket-seller.ts';

export type GuestTicket = {
  id?: string; ticket_title: string; event_name?: string | null; qr_code_data: string;
  receipt_kind?: string | null; quantity?: number | null; ticket_image_url?: string | null;
  event_start_date?: string | null; location_name?: string | null; location_address?: string | null;
  entry_conditions?: string | null; total_price?: number | null; currency?: string | null;
  seller?: TicketSeller;
};
const bytes = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const navy = rgb(.04,.09,.20), muted = rgb(.73,.79,.88), white = rgb(1,1,1);
function wrap(value: unknown, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = []; let line = '';
  for (const char of String(value ?? '').slice(0,4000)) {
    if (char === '\n' || font.widthOfTextAtSize(line + char,size) > width) {lines.push(line);line='';}
    if (char !== '\n') line += char;
  }
  lines.push(line); return lines;
}
/** Fetch only our public storage images: no redirects, arbitrary hosts or unbounded bodies. */
async function flyerBytes(url: string | null | undefined, supabaseUrl: string): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const target=new URL(url), origin=new URL(supabaseUrl);
    if(target.protocol!=='https:' || target.origin!==origin.origin || !target.pathname.startsWith('/storage/v1/object/public/'))return null;
    const response=await fetch(target,{redirect:'error',signal:AbortSignal.timeout(4000)});
    if(!response.ok || !/^image\/(png|jpeg)(;|$)/i.test(response.headers.get('content-type') || ''))return null;
    if(Number(response.headers.get('content-length'))>3_000_000)return null;
    const reader=response.body?.getReader();if(!reader)return null;
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>3_000_000){await reader.cancel();return null;}chunks.push(next.value);}
    const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
  } catch {return null;}
}
/** One branded ticket-template page per authoritative receipt; the QR payload is unchanged. */
export async function createGuestTicketPdf(tickets: GuestTicket[], orderNumber: string, supabaseUrl: string, trackingCode?: string): Promise<string> {
  if(!tickets.length || tickets.length>100)throw new Error('Invalid ticket document size');
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
  const font=await pdf.embedFont(bytes(notoSansBase64),{subset:true});
  pdf.setTitle(`60Seconds tickets — ${orderNumber}`);pdf.setCreator('60Seconds');
  const flyers=new Map<string,Uint8Array | null>();
  for(const ticket of tickets){
    if(!ticket.qr_code_data || ticket.qr_code_data.length>4096)throw new Error('Invalid ticket QR');
    const date=ticket.event_start_date?new Date(ticket.event_start_date):null;
    const dateLabel=date && !Number.isNaN(date.getTime()) ? date.toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'long',timeStyle:'short'})+' UTC' : 'Event date not provided';
    const rows=[['Starts',dateLabel],['Category',ticket.ticket_title],['Price',ticket.total_price==null?'Price unavailable':`${Number(ticket.total_price).toFixed(2)} ${ticket.currency || ''}`],
      ['Venue',[ticket.location_name,ticket.location_address].filter(Boolean).join('\n') || 'Venue not provided'],
      ['Conditions',ticket.entry_conditions || 'Contact the organiser for entry conditions.'],
      ['Organiser',[ticket.seller?.name || 'Business details unavailable',ticket.seller?.username?`@${ticket.seller.username}`:'',ticket.seller?.address,ticket.seller?.phone,ticket.seller?.website].filter(Boolean).join('\n')]];
    const title=wrap(ticket.event_name || ticket.ticket_title,font,23,400);
    const formatted=rows.map(([label,value])=>({label,lines:wrap(value,font,11,270)}));
    const detailsHeight=title.length*30+formatted.reduce((sum,row)=>sum+Math.max(1,row.lines.length)*16+20,0)+40;
    const height=250+detailsHeight+330+65;
    const page=pdf.addPage([460,height]);page.drawRectangle({x:0,y:0,width:460,height,color:navy});
    const draw=(text:string,x:number,y:number,size=11,color=white)=>page.drawText(text,{x,y,size,font,color});
    const url=ticket.ticket_image_url || '';if(!flyers.has(url))flyers.set(url,await flyerBytes(url,supabaseUrl));
    const flyer=flyers.get(url);
    if(flyer){try{const image=flyer[0]===137?await pdf.embedPng(flyer):await pdf.embedJpg(flyer);const scaled=image.scaleToFit(460,250);page.drawImage(image,{x:(460-scaled.width)/2,y:height-250+(250-scaled.height)/2,width:scaled.width,height:scaled.height});}catch{draw('Event flyer unavailable',145,height-130,12,muted);}}
    else draw('Event flyer unavailable',145,height-130,12,muted);
    let y=height-285;for(const line of title){draw(line,24,y,23);y-=30;}y-=10;
    for(const row of formatted){draw(row.label,24,y,10,muted);for(const line of row.lines){draw(line,150,y);y-=16;}y-=20;page.drawLine({start:{x:24,y:y+9},end:{x:436,y:y+9},color:muted,opacity:.25,thickness:.5});}
    const stubTop=395;page.drawLine({start:{x:20,y:stubTop},end:{x:440,y:stubTop},color:muted,dashArray:[5,5]});
    page.drawCircle({x:0,y:stubTop,size:11,color:white});page.drawCircle({x:460,y:stubTop,size:11,color:white});
    const qr=QRCode.create(ticket.qr_code_data,{errorCorrectionLevel:'M'}).modules, unit=200/(qr.size+8),left=130,bottom=155;
    page.drawRectangle({x:left,y:bottom,width:200,height:200,color:white});
    for(let row=0;row<qr.size;row++)for(let col=0;col<qr.size;col++)if(qr.get(row,col))page.drawRectangle({x:left+(col+4)*unit,y:bottom+(qr.size+3-row)*unit,width:unit,height:unit,color:rgb(0,0,0)});
    for(const [i,line] of wrap(`Ticket no. ${ticket.id || ticket.qr_code_data}`,font,10,410).entries())draw(line,24,133-i*13,10);
    draw(`Order: ${String(orderNumber).slice(0,60)} | Quantity: ${ticket.quantity || 1}`,24,98,10,muted);
    draw('Present this QR at the entrance or collection point.',24,78,10,muted);
    if(trackingCode)draw(`Order lookup code: ${trackingCode}`,24,64,8,muted);
    page.drawRectangle({x:0,y:0,width:460,height:58,color:rgb(.025,.06,.13)});draw('SOLD ON   60SECONDS',101,22,20);
  }
  return pdf.saveAsBase64();
}
