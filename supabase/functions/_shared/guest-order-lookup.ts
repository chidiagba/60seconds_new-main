import { createGuestTicketPdf } from './guest-ticket-pdf.ts';
import { loadGuestTicketPages } from './guest-ticket-pages.ts';

export const validGuestTrackingCode = (value: unknown): value is string => typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
/** Read-only recovery: never verify a payment, trigger delivery or initiate a refund here. */
export async function lookupGuestOrder(db: any, input: {trackingCode:string;email:string;action?:string}, supabaseUrl:string,
  renderPdf=createGuestTicketPdf) {
  const missing={status:404,body:{error:'Order not found. Check the tracking code and checkout email.'}};
  const {data:checkout,error}=await db.from('guest_checkouts').select('order_id,state,email_sent_at').eq('tracking_code',input.trackingCode.trim().toLowerCase()).maybeSingle();
  if(error)throw error;if(!checkout)return missing;
  const {data:order,error:orderError}=await db.from('orders').select('id,business_id,guest_email,order_number,payment_status,total_amount,currency,created_at').eq('id',checkout.order_id).maybeSingle();
  if(orderError)throw orderError;
  if(!order || order.guest_email?.trim().toLowerCase()!==input.email.trim().toLowerCase())return missing;
  const paid=checkout.state==='paid' && order.payment_status==='completed';
  if(input.action==='ticket-pdf'){
    if(!paid)return{status:409,body:{error:'Tickets are available only after payment is confirmed.'}};
    const pages=await loadGuestTicketPages(db,order);
    return{status:200,body:{pdf:await renderPdf(pages,String(order.order_number),supabaseUrl,input.trackingCode),filename:`60Seconds-${String(order.order_number).replace(/[^a-zA-Z0-9_-]/g,'_')}.pdf`}};
  }
  return{status:200,body:{orderNumber:order.order_number,state:checkout.state,paymentStatus:order.payment_status,totalAmount:order.total_amount,currency:order.currency,createdAt:order.created_at,emailSent:!!checkout.email_sent_at,canDownload:paid}};
}
