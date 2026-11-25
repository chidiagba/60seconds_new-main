import { createGuestTicketPdf } from './guest-ticket-pdf.ts';
import { loadGuestTicketPages } from './guest-ticket-pages.ts';
import { toMinorUnits, currencyDigits } from '../../../utils/commerce-rules.ts';
import QRCode from 'npm:qrcode@1.5.4';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const escape = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export async function fulfillGuestSession(session: {id:string;metadata?:Record<string,string> | null;amount_total?:number | null;currency?:string | null}, paid: boolean): Promise<Response> {
  const id = session.metadata?.guest_order_id;
  if (!id) return new Response("Ignored");
  const db = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let deliveryRejected=false;
  try {
    const { data: expected, error: expectedError } = await db.from('orders').select('total_amount,currency').eq('id',id).single();
    if (expectedError || !expected || (paid && (session.amount_total !== toMinorUnits(expected.total_amount,expected.currency) || session.currency !== expected.currency.toLowerCase()))) throw new Error('Payment amount mismatch');
    const settlement=paid
      ? db.rpc('settle_verified_guest_payment',{order_key:id,provider:session.id.startsWith('guest_paystack_')?'paystack':'stripe',reference:session.id,
          paid_amount:Number(session.amount_total)/10**currencyDigits(expected.currency),paid_currency:expected.currency,transaction_key:String((session as any).payment_intent || session.id)})
      : db.rpc('finish_guest_order',{order_key:id,paid:false,session_key:session.id});
    const {data:order,error}=await settlement;
    if (error) throw error;
    if (!paid) return new Response('Released');
    const { data: checkout } = await db.from('guest_checkouts').select('state,email_sent_at,tracking_code').eq('order_id',id).single();
    if (checkout?.state !== 'paid') throw new Error('Order not fulfilled');
    if (checkout.email_sent_at) return new Response('Already delivered');
    const pdfTickets = await loadGuestTicketPages(db,order);
    const allReceipts = pdfTickets;
    const pdf = await createGuestTicketPdf(pdfTickets,String(order.order_number),Deno.env.get('SUPABASE_URL')!,checkout.tracking_code);
    const attachments: {Name:string;Content:string;ContentType:string;ContentID?:string}[] = [{
      Name:`60Seconds-tickets-${String(order.order_number).replace(/[^a-zA-Z0-9_-]/g,'_')}.pdf`,Content:pdf,ContentType:'application/pdf',
    }];
    let html = `<h1>Order ${escape(order.order_number)}</h1><p>Your 60Seconds ticket PDF is attached. Save it or print it, and show each ticket QR code at the appropriate entrance or collection point. No account is required.</p>`;
    for (const [index,receipt] of allReceipts.entries()) {
      const image = await QRCode.toDataURL(receipt.qr_code_data,{width:400,margin:2});
      attachments.push({Name:`qr-${index}.png`,Content:image.split(',')[1],ContentType:'image/png',ContentID:`cid:qr-${index}`});
      html += `<h2>${escape(receipt.ticket_title)} × ${receipt.quantity}</h2><p>${escape(receipt.receipt_kind)}</p>`;
      if (/^https:\/\//.test(receipt.ticket_image_url || '')) html += `<img src="${escape(receipt.ticket_image_url)}" width="320" alt="Event flyer"/>`;
      html += `<p><img src="cid:qr-${index}" width="240" alt="Purchase QR code"/></p>`;
    }
    if (!checkout.tracking_code) throw new Error('Guest tracking code unavailable');
    const lookupBase=(Deno.env.get('PUBLIC_EVENT_BASE_URL') || 'https://events.60secondsapp.io').replace(/\/$/,'');
    const lookupUrl=`${lookupBase}/guest-order#code=${encodeURIComponent(checkout.tracking_code)}`;
    html += `<h2>Find your order or download tickets again</h2><p>Tracking code: <strong>${escape(checkout.tracking_code)}</strong></p><p><a href="${escape(lookupUrl)}">Open guest order lookup</a>, enter the email used at checkout and select Find order. You can check payment status and download your paid tickets. Keep this code private. It is separate from the QR code used for admission.</p>`;
    const subject = `Your 60seconds order ${order.order_number}`;
    const text = `Your order ${order.order_number}. Your 60Seconds ticket-template PDF is attached. Save or print it and present each ticket QR code at the entrance or collection point. No account is required. Tracking code: ${checkout.tracking_code}. Open ${lookupUrl}, enter the checkout email and select Find order. Keep this code private; use the ticket QR for admission.`;
    const sender = Deno.env.get('POSTMARK_FROM_EMAIL') || 'support@60secondsapp.io';
    const {data:claimed,error:claimError}=await db.rpc('claim_guest_email',{p_order:id});
    if(claimError) throw claimError;
    if(!claimed) return new Response('Delivery already claimed');
    if (Deno.env.get('GUEST_EMAIL_PROVIDER') === 'sendgrid') {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SENDGRID_API_KEY')}` },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: order.guest_email }] }],
          from: { email: sender }, subject,
          content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
          attachments: attachments.map(a => ({ filename: a.Name, content: a.Content,
            type: a.ContentType, disposition: a.ContentID ? 'inline' : 'attachment',
            ...(a.ContentID ? {content_id:a.ContentID.replace(/^cid:/, '')} : {}) })),
        }),
      });
      if (!response.ok) {deliveryRejected=response.status<500;throw new Error(`Email delivery failed (${response.status})`);}
    } else {
      const response = await fetch('https://api.postmarkapp.com/email', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Postmark-Server-Token': Deno.env.get('POSTMARK_API_KEY')! },
        body: JSON.stringify({ From: sender, To: order.guest_email, Subject: subject,
          HtmlBody: html, TextBody: text, Attachments: attachments }),
      });
      const result = await response.json();
      if (!response.ok || result.ErrorCode) {deliveryRejected=response.status<500;throw new Error('Email delivery failed');}
    }
    const { error: emailError } = await db.from('guest_checkouts').update({email_sent_at:new Date().toISOString()}).eq('order_id',id);
    if (emailError) throw emailError;
    return new Response('OK');
  } catch(error) {
    if(deliveryRejected) await db.from('guest_checkouts').update({email_sending_at:null}).eq('order_id',id).is('email_sent_at',null);
    console.error('Guest fulfillment failed',error); return new Response('Retry fulfillment',{status:500}); }
}
