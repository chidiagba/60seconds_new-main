import { loadTicketSellers } from '../../../lib/ticket-seller.ts';

export async function loadGuestTicketPages(db: any, order: any) {
  const id=order.id;
  const { data: receipts, error: receiptError } = await db.from('ticket_receipts').select('*').eq('order_id',id);
  if (receiptError) throw receiptError;
  const { data: bookings, error: bookingError } = await db.from('event_table_bookings').select('*').eq('order_id',id).eq('state','confirmed');
  if (bookingError) throw bookingError;
  const {data: venueBookings,error: venueError} = await db.from('table_reservations').select('*').eq('order_id',id).eq('status','confirmed');
  if (venueError) throw venueError;
  const venueReceipts = (venueBookings || []).map((b:any)=>({id:b.id,event_start_date:b.starts_at,owner_id:order.business_id,total_price:b.total_amount,currency:order.currency,ticket_title:`${b.table_name} · ${b.guest_name} · ${b.starts_at} · ${b.party_size} guests`,quantity:1,receipt_kind:'Table reservation',qr_code_data:`RESERVATION:${b.id}`}));
  const allReceipts = [...(receipts || []), ...venueReceipts, ...(bookings || []).map((b: { table_name: string; seats: number; qr_code: string }) => ({
    ticket_title: b.table_name, owner_id:order.business_id, quantity: b.seats, receipt_kind: 'Reserved table seats',
    qr_code_data: b.qr_code, ticket_image_url: null,
  }))];
  if (!allReceipts.length) throw new Error('Receipts unavailable');
  const sellers = await loadTicketSellers(db,allReceipts.map(receipt=>receipt.owner_id || order.business_id));
  const pdfTickets = allReceipts.map(receipt=>({...receipt,seller:sellers.get(receipt.owner_id || order.business_id)}));
  return pdfTickets;
}
