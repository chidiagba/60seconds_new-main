import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { ImageIcon } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import QRCode from 'react-native-qrcode-svg';
import type { TicketSeller } from '@/lib/ticket-seller';

export type PurchasedTicket = {
  id: string; ticket_title: string; event_name?: string | null;
  ticket_image_url?: string | null; event_start_date?: string | null;
  location_name?: string | null; location_address?: string | null;
  entry_conditions?: string | null; seller?: TicketSeller;
  qr_code_data: string; order_number: string; currency?: string | null;
  total_price?: number | null; quantity?: number | null; seat_no?: string | null;
  receipt_kind?: 'ticket' | 'product' | null; ticket_type?: string | null;
  is_active: boolean; redeemed_at?: string | null;
};

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={s.row}><Text style={s.label}>{label}</Text><View style={s.valueWrap}><Text style={s.value}>{children}</Text></View></View>;
}

export default function PurchasedTicketCard({ ticket: t, sample = false }: { ticket: PurchasedTicket; sample?: boolean }) {
  const date = t.event_start_date ? new Date(t.event_start_date) : null;
  const validDate = date && !Number.isNaN(date.getTime()) ? date : null;
  const product = t.receipt_kind === 'product' || (!t.receipt_kind && String(t.ticket_type || 'ticket').toLowerCase() !== 'ticket');
  const price = t.total_price == null ? 'Price unavailable' : `${Number(t.total_price).toFixed(2)} ${t.currency || ''}`.trim();
  return <View style={s.card}>
    {t.ticket_image_url ? <Image source={{ uri: t.ticket_image_url }} style={s.flyer} contentFit="cover" accessibilityLabel="Organiser flyer" /> :
      <View style={[s.flyer, s.placeholder]}><ImageIcon size={34} color="#B9C9E5" /><Text style={s.placeholderTitle}>{sample ? 'SAMPLE EVENT FLYER' : 'Event flyer unavailable'}</Text><Text style={s.muted}>{sample ? 'Organiser artwork appears here' : '60seconds'}</Text></View>}
    <LinearGradient colors={['#0A1733', '#10264F', '#173163']} style={s.body}>
      <View style={s.details}>
        {sample && <Text style={s.sample}>SAMPLE · NOT VALID FOR ENTRY</Text>}
        <Text style={s.title}>{t.event_name || t.ticket_title}</Text>
        {!product && <View style={s.dateRow}><View style={s.day}><Text style={s.dayText}>{validDate ? validDate.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase() : 'TBA'}</Text></View><Text style={s.date}>{validDate ? validDate.toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' }) : 'Event date not provided'}</Text></View>}
        {!product && <Detail label="Starts">{validDate ? validDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : 'Time not provided'}</Detail>}
        <Detail label={product ? 'Product' : 'Category'}>{t.ticket_title}</Detail>
        <Detail label="Price">{price}</Detail>
        <Detail label="Venue">{[t.location_name, t.location_address].filter(Boolean).join('\n') || 'Venue not provided'}</Detail>
        {!product && <Detail label="Conditions">{t.entry_conditions || 'Entry conditions not provided. Contact the organiser.'}</Detail>}
        <View style={s.row}><Text style={s.label}>Organiser</Text><View style={s.organiser}><View style={s.logo}><Text style={s.logoText}>{(t.seller?.name || '?').slice(0, 1).toUpperCase()}</Text></View><View style={s.organiserName}><Text style={s.value}>{t.seller?.name || 'Business details unavailable'}</Text>{!!t.seller?.username && <Text style={s.muted}>@{t.seller.username}</Text>}</View></View></View>
      </View>
      <View style={s.perforation}><View style={[s.notch, s.left]} /><View style={s.dashes} /><View style={[s.notch, s.right]} /></View>
      <View style={s.stub}>
        {!!t.qr_code_data && <View style={s.qrBorder}><View style={s.qr}><QRCode value={t.qr_code_data} size={156} quietZone={8} color="#0A1733" backgroundColor="#FFFFFF" /></View></View>}
        <Text style={s.ticketNumber}>Ticket no. <Text style={s.number}>{t.id}</Text></Text>
        <Text style={s.status}>{sample ? 'PREVIEW · NOT VALID FOR ENTRY' : t.redeemed_at ? 'REDEEMED' : t.is_active ? 'VALID · NOT YET REDEEMED' : 'INACTIVE'}</Text>
        <Text style={s.muted}>Order {t.order_number} · Quantity {Math.max(1, Number(t.quantity || 1))}</Text>
        {!!t.seat_no && <Text style={s.muted}>Seat: {t.seat_no}</Text>}
      </View>
    </LinearGradient>
    <View style={s.footer}><Text style={s.sold}>SOLD ON</Text><Image source={require('@/assets/images/icon.png')} style={s.brandIcon} /><Text style={s.brand}>60SECONDS</Text></View>
  </View>;
}
const s = StyleSheet.create({
  card: { borderRadius: 22, overflow: 'hidden', backgroundColor: '#0A1733', borderWidth: 1, borderColor: '#28416A' },
  flyer: { width: '100%', aspectRatio: 1.23 },
  placeholder: { backgroundColor: '#182C4F', justifyContent: 'center', alignItems: 'center', gap: 10 },
  placeholderTitle: { color: '#D9E5FA', fontSize: 16, fontWeight: '700' },
  body: { borderTopWidth: 1, borderTopColor: '#8293AF', borderStyle: 'dashed' },
  details: { paddingHorizontal: 20, paddingTop: 20 },
  sample: { color: '#FCD34D', fontWeight: '700', fontSize: 11, marginBottom: 12 },
  title: { color: '#FFFFFF', fontSize: 24, fontWeight: '800' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 12, flexWrap: 'wrap' },
  day: { backgroundColor: '#6574E8', borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4 },
  dayText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  date: { color: '#E0E8F8', fontSize: 14 },
  row: { flexDirection: 'row', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.15)', alignItems: 'flex-start' },
  label: { width: '32%', color: '#BBC9E0', fontSize: 14, paddingRight: 10, lineHeight: 21 },
  valueWrap: { flex: 1 }, value: { color: '#FFFFFF', fontSize: 15, lineHeight: 22 },
  organiser: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  organiserName: { flex: 1 }, logo: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#2E4771', alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#FFFFFF', fontWeight: '800', fontSize: 19 },
  muted: { color: '#BBC9E0', fontSize: 12, lineHeight: 19 },
  perforation: { height: 30, justifyContent: 'center', marginTop: 4 },
  dashes: { marginHorizontal: 22, borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#8293AF' },
  notch: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: '#0B0B15', top: 4 },
  left: { left: -11 }, right: { right: -11 },
  stub: { paddingHorizontal: 20, paddingTop: 32, paddingBottom: 42, alignItems: 'center', gap: 10 },
  qrBorder: { padding: 13, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#A8B9D5', borderRadius: 14, marginBottom: 5 },
  qr: { padding: 4, backgroundColor: '#FFFFFF', borderRadius: 4 },
  ticketNumber: { color: '#C9D5EB', fontSize: 13, textAlign: 'center', lineHeight: 21 },
  number: { color: '#FFFFFF', fontWeight: '700' }, status: { color: '#D9E5FA', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  footer: { backgroundColor: '#071022', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 18, gap: 12 },
  sold: { color: '#C2CDE1', fontSize: 10, letterSpacing: 2 }, brand: { color: '#FFFFFF', fontSize: 19, fontWeight: '700', letterSpacing: 2 },
  brandIcon: { width: 29, height: 29, borderRadius: 5 },
});
