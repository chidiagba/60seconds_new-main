import type {TicketSeller} from '../lib/ticket-seller';
import QRCode from 'qrcode';
import { Buffer } from 'buffer';
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export const ticketDocumentFileName = (ticket: { id: string; order_number: string }) =>
  `${ticket.order_number}-${ticket.id}-seller-v6-layout-v7.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');

export function receiptQrImage(value: string): string {
  if (!value) throw new Error('A receipt QR code is required');
  const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const paths: string[] = [];
  for (let row = 0; row < modules.size; row++) for (let col = 0; col < modules.size; col++) {
    if (modules.get(row, col)) paths.push(`M${col + 4} ${row + 4}h1v1h-1z`);
  }
  const size = modules.size + 8;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><path fill="white" d="M0 0h${size}v${size}H0z"/><path fill="black" d="${paths.join('')}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** Each document uses its receipt's QR, never the shared order number. */
export function ticketDocumentHtml(ticket: {
  id?: string; seller?: TicketSeller; ticket_title: string; event_name?: string | null;
  order_number: string; qr_code_data: string; quantity?: number | null;
  event_start_date?: string | null; location_name?: string | null;
  location_address?: string | null; entry_conditions?: string | null;
  total_price?: number | null; currency?: string | null;
}, qrImage: string, flyerImage?: string | null) {
  const safeImage = (uri: string) => /^data:image\/(png|jpe?g|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(uri) || /^https:\/\//i.test(uri);
  if (!ticket.qr_code_data || !safeImage(qrImage)) throw new Error('A valid receipt QR code is required');
  const rawDate = ticket.event_start_date ? new Date(ticket.event_start_date) : null;
  const date = rawDate && !Number.isNaN(rawDate.getTime()) ? rawDate : null;
  const row = (label: string, value: unknown) => `<div class="row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(ticket.ticket_title)}</title>
  <style>@page{margin:20px}*{box-sizing:border-box}body{font-family:Arial,sans-serif;background:white;color:white}article{max-width:460px;margin:auto;border-radius:22px;overflow:hidden;background:linear-gradient(120deg,#0A1733,#10264F,#173163);print-color-adjust:exact;-webkit-print-color-adjust:exact}.flyer{width:100%;height:330px;object-fit:cover;display:block}.placeholder{height:330px;background:#182C4F;display:flex;align-items:center;justify-content:center;color:#BBC9E0}.details{padding:24px}h1{font-size:26px;margin:0 0 12px}.date{margin-bottom:16px;color:#D9E5FA}.day{background:#6574E8;padding:4px 8px;border-radius:5px;color:white;margin-right:8px}.row{display:flex;border-bottom:1px solid #ffffff30;padding:14px 0;font-size:15px;line-height:1.5}.row span{width:32%;color:#BBC9E0}.row strong{width:68%;font-weight:500;white-space:pre-line;overflow-wrap:anywhere}.stub{position:relative;border-top:2px dashed #8293AF;margin:0 22px;padding:40px 0;text-align:center}.stub:before,.stub:after{content:'';position:absolute;top:-12px;width:22px;height:22px;background:white;border-radius:50%}.stub:before{left:-33px}.stub:after{right:-33px}.qrframe{display:inline-block;padding:16px;border:2px dashed #A8B9D5;border-radius:14px}.qr{width:180px;height:180px;display:block}.number{overflow-wrap:anywhere;font-size:14px}.meta{font-size:12px;color:#BBC9E0}footer{background:#071022;text-align:center;padding:24px;font-size:24px;letter-spacing:3px}footer small{font-size:11px;letter-spacing:2px;margin-right:18px}</style></head><body><article>
  ${flyerImage && safeImage(flyerImage) ? `<img class="flyer" src="${escapeHtml(flyerImage)}" alt="Event flyer">` : '<div class="placeholder">Event flyer unavailable</div>'}
  <section class="details"><h1>${escapeHtml(ticket.event_name || ticket.ticket_title)}</h1>
  <div class="date"><b class="day">${escapeHtml(date ? date.toLocaleDateString(undefined,{weekday:'short'}).toUpperCase() : 'TBA')}</b>${escapeHtml(date ? date.toLocaleDateString(undefined,{day:'2-digit',month:'long',year:'numeric'}) : 'Event date not provided')}</div>
  ${row('Starts',date ? date.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}) : 'Time not provided')}
  ${row('Category',ticket.ticket_title)}
  ${row('Price',ticket.total_price == null ? 'Price unavailable' : `${Number(ticket.total_price).toFixed(2)} ${ticket.currency || ''}`)}
  ${row('Venue',[ticket.location_name,ticket.location_address].filter(Boolean).join('\n') || 'Venue not provided')}
  ${row('Conditions',ticket.entry_conditions || 'Entry conditions not provided. Contact the organiser.')}
  ${row('Organiser',[ticket.seller?.name || 'Business details unavailable',ticket.seller?.username ? `@${ticket.seller.username}` : null].filter(Boolean).join('\n'))}
  <p class="meta">Sold by ${escapeHtml([ticket.seller?.address,ticket.seller?.phone,ticket.seller?.website].filter(Boolean).join(' · '))}</p></section>
  <section class="stub"><div class="qrframe"><img class="qr" src="${escapeHtml(qrImage)}" alt="Receipt QR code"></div>
  <p class="number">Ticket no. <b>${escapeHtml(ticket.id || 'Unavailable')}</b></p>
  <p class="meta">Order: ${escapeHtml(ticket.order_number)} · Quantity: ${escapeHtml(ticket.quantity || 1)}</p>
  <p class="meta">Present this QR code at the entrance or product collection point.</p></section>
  <footer><small>SOLD ON</small>60SECONDS</footer></article></body></html>`;
}
