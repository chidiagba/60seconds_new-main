import { toMinorUnits } from '../../../utils/commerce-rules.ts';
import QRCode from 'npm:qrcode@1.5.4';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const escape = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export async function fulfillGuestSession(session: {id:string;metadata?:Record<string,string> | null;amount_total?:number | null;currency?:string | null}, paid: boolean): Promise<Response> {
  const id = session.metadata?.guest_order_id;
  if (!id) return new Response("Ignored");
  const db = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const { data: expected, error: expectedError } = await db.from('orders').select('total_amount,currency').eq('id',id).single();
    if (expectedError || !expected || (paid && (session.amount_total !== toMinorUnits(expected.total_amount,expected.currency) || session.currency !== expected.currency.toLowerCase()))) throw new Error('Payment amount mismatch');
    const { data: order, error } = await db.rpc('finish_guest_order',{order_key:id,paid,session_key:session.id});
    if (error) throw error;
    if (!paid) return new Response('Released');
    const { data: checkout } = await db.from('guest_checkouts').select('state,email_sent_at').eq('order_id',id).single();
    if (checkout?.state !== 'paid') throw new Error('Order not fulfilled');
    if (checkout.email_sent_at) return new Response('Already delivered');
    const { data: receipts, error: receiptError } = await db.from('ticket_receipts').select('*').eq('order_id',id);
    if (receiptError) throw receiptError;
    const { data: bookings, error: bookingError } = await db.from('event_table_bookings').select('*').eq('order_id',id).eq('state','confirmed');
    if (bookingError) throw bookingError;
    const {data: venueBookings,error: venueError} = await db.from('table_reservations').select('*').eq('order_id',id).eq('status','confirmed');
    if (venueError) throw venueError;
    const venueReceipts = (venueBookings || []).map((b:any)=>({ticket_title:`${b.table_name} · ${b.guest_name} · ${b.starts_at} · ${b.party_size} guests`,quantity:1,receipt_kind:'Table reservation',qr_code_data:`RESERVATION:${b.id}`}));
    const allReceipts = [...(receipts || []), ...venueReceipts, ...(bookings || []).map((b: { table_name: string; seats: number; qr_code: string }) => ({
      ticket_title: b.table_name, quantity: b.seats, receipt_kind: 'Reserved table seats',
      qr_code_data: b.qr_code, ticket_image_url: null,
    }))];
    if (!allReceipts.length) throw new Error('Receipts unavailable');
    const attachments = [];
    let html = `<h1>Order ${escape(order.order_number)}</h1><p>Show each QR code at the appropriate entrance or collection point.</p>`;
    for (const [index,receipt] of allReceipts.entries()) {
      const image = await QRCode.toDataURL(receipt.qr_code_data,{width:400,margin:2});
      attachments.push({Name:`qr-${index}.png`,Content:image.split(',')[1],ContentType:'image/png',ContentID:`cid:qr-${index}`});
      html += `<h2>${escape(receipt.ticket_title)} × ${receipt.quantity}</h2><p>${escape(receipt.receipt_kind)}</p>`;
      if (/^https:\/\//.test(receipt.ticket_image_url || '')) html += `<img src="${escape(receipt.ticket_image_url)}" width="320" alt="Event flyer"/>`;
      html += `<p><img src="cid:qr-${index}" width="240" alt="Purchase QR code"/></p>`;
    }
    const subject = `Your 60seconds order ${order.order_number}`;
    const text = `Your order ${order.order_number}. Your ticket, product and table reservation QR codes are attached.`;
    const sender = Deno.env.get('POSTMARK_FROM_EMAIL') || 'support@60secondsapp.io';
    if (Deno.env.get('GUEST_EMAIL_PROVIDER') === 'sendgrid') {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SENDGRID_API_KEY')}` },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: order.guest_email }] }],
          from: { email: sender }, subject,
          content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
          attachments: attachments.map(a => ({ filename: a.Name, content: a.Content,
            type: a.ContentType, disposition: 'inline', content_id: a.ContentID.replace(/^cid:/, '') })),
        }),
      });
      if (!response.ok) throw new Error(`Email delivery failed (${response.status})`);
    } else {
      const response = await fetch('https://api.postmarkapp.com/email', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Postmark-Server-Token': Deno.env.get('POSTMARK_API_KEY')! },
        body: JSON.stringify({ From: sender, To: order.guest_email, Subject: subject,
          HtmlBody: html, TextBody: text, Attachments: attachments }),
      });
      const result = await response.json();
      if (!response.ok || result.ErrorCode) throw new Error('Email delivery failed');
    }
    const { error: emailError } = await db.from('guest_checkouts').update({email_sent_at:new Date().toISOString()}).eq('order_id',id);
    if (emailError) throw emailError;
    return new Response('OK');
  } catch(error) { console.error('Guest fulfillment failed',error); return new Response('Retry fulfillment',{status:500}); }
}
