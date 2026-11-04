import QRCode from 'qrcode';
import { Buffer } from 'buffer';
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export const ticketDocumentFileName = (ticket: { id: string; order_number: string }) =>
  `${ticket.order_number}-${ticket.id}-event-flyer-v5.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');

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
export function ticketDocumentHtml(ticket: { ticket_title: string; event_name?: string | null; order_number: string; qr_code_data: string; quantity?: number | null; event_start_date?: string | null; location_name?: string | null }, qrImage: string, flyerImage?: string | null) {
  const safeImage = (uri: string) => /^data:image\/(png|jpe?g|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(uri) || /^https:\/\//i.test(uri);
  if (!ticket.qr_code_data || !safeImage(qrImage)) throw new Error('A valid receipt QR code is required');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(ticket.ticket_title)}</title>
  <style>@page{margin:24px}body{font-family:Arial,sans-serif;color:#171722}article{max-width:620px;margin:auto}img{display:block;object-fit:contain} .flyer{width:100%;max-height:280px}.qr{width:200px;height:200px;margin:16px auto}h1{font-size:24px}p{margin:10px 0}</style></head><body><article>
  <h1>60seconds · ${escapeHtml(ticket.ticket_title)}</h1>
  ${flyerImage && safeImage(flyerImage) ? `<img class="flyer" src="${escapeHtml(flyerImage)}" alt="Event flyer">` : ''}
  <h2>${escapeHtml(ticket.event_name)}</h2><p>Order: ${escapeHtml(ticket.order_number)}</p>
  <p>Quantity: ${escapeHtml(ticket.quantity || 1)}</p><p>${escapeHtml(ticket.event_start_date ? new Date(ticket.event_start_date).toLocaleString() : '')}</p>
  <p>${escapeHtml(ticket.location_name)}</p><img class="qr" src="${escapeHtml(qrImage)}" alt="Receipt QR code">
  <p>Present this QR code at the entrance or product collection point.</p></article></body></html>`;
}
