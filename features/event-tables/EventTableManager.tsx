import React, { useCallback, useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '@/lib/supabase';

export default function EventTableManager({ eventId, currency, onChange }: { eventId: string; currency?: string; onChange?: () => void }) {
  const [eventCurrency, setEventCurrency] = useState(currency || '');
  const [tables, setTables] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [exclusive, setExclusive] = useState(true);
  const [visible, setVisible] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [seats, setSeats] = useState('');
  const [price, setPrice] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [t, b, e] = await Promise.all([
      supabase.from('event_tables').select('*').eq('event_id', eventId).order('created_at'),
      supabase.from('event_table_bookings').select('*').eq('event_id', eventId).eq('state', 'confirmed').order('created_at', { ascending: false }),
      supabase.from('events').select('currency').eq('id', eventId).single(),
    ]);
    if (t.error || b.error || e.error) { setMessage(t.error?.message || b.error?.message || e.error?.message || 'Could not load tables'); return; }
    if (e.data?.currency) setEventCurrency(e.data.currency);
    setTables(t.data || []); setBookings(b.data || []);
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);
  async function save(table?: any) {
    const count = table ? table.seats : Number(seats);
    const amount = table ? Number(table.seat_price) : Number(price);
    if (!(table?.name || name).trim() || !Number.isInteger(count) || count < 1 || count > 500 || !Number.isFinite(amount) || amount <= 0) {
      setMessage('Enter a table name, 1–500 seats and a positive booking price.'); return;
    }
    setBusy(true); setMessage('');
    try {
      const { error } = await supabase.rpc('save_event_table', {
        event_key: eventId, table_key: table?.id || editing, table_name: table?.name || name,
        seat_count: count, price: amount, active: table ? !table.is_active : visible, exclusive: table ? table.whole_table : exclusive,
      });
      if (error) throw error;
      setVisible(true); setEditing(null); setName(''); setSeats(''); setPrice('');
      await load(); onChange?.();
    } catch (e: any) { setMessage(e.message || 'Unable to save table'); }
    finally { setBusy(false); }
  }
  const input = { backgroundColor: '#fff', color: '#111', padding: 12, borderRadius: 8, marginTop: 8 };
  const button = { padding: 12, borderRadius: 8, backgroundColor: '#4338ca', marginTop: 10 };
  return <View style={{ padding: 16, backgroundColor: '#20202c', marginVertical: 20, borderRadius: 12 }}>
    <Text style={{ color: '#fff', fontSize: 22 }}>Manage event tables</Text>
    <Text style={{ color: '#ccc', marginVertical: 8 }}>Set a booking price in {eventCurrency}. Choose a whole table with a fixed guest capacity or individual seats. A 4% platform fee is added at checkout.</Text>
    {tables.map(t => <View key={t.id} style={{ paddingVertical: 10 }}>
      <Text style={{ color: '#fff' }}>{t.name} · {t.seats} seats · {t.seat_price} {eventCurrency}/{t.whole_table ? 'table' : 'seat'} · {t.is_active ? 'Visible' : 'Hidden'}</Text>
      <TouchableOpacity disabled={busy} style={button} onPress={() => { setExclusive(t.whole_table); setEditing(t.id); setVisible(t.is_active); setName(t.name); setSeats(String(t.seats)); setPrice(String(t.seat_price)); }}><Text style={{ color: '#fff' }}>Edit</Text></TouchableOpacity>
      <TouchableOpacity disabled={busy} style={button} onPress={() => save(t)}><Text style={{ color: '#fff' }}>{t.is_active ? 'Hide' : 'Show'} table</Text></TouchableOpacity>
    </View>)}
    <Text style={{ color: '#fff', marginTop: 12 }}>{editing ? 'Edit table' : 'Add a table'}</Text>
    <TextInput accessibilityLabel="Table name" placeholder="Table name, e.g. VIP balcony" value={name} onChangeText={setName} maxLength={80} style={input} />
    <TextInput accessibilityLabel="Number of seats" placeholder="Number of seats" value={seats} onChangeText={setSeats} keyboardType="number-pad" style={input} />
    <TextInput accessibilityLabel="Price per seat" placeholder={`Price per ${exclusive ? "table" : "seat"} (${eventCurrency})`} value={price} onChangeText={setPrice} keyboardType="decimal-pad" style={input} />
    <TouchableOpacity accessibilityRole="button" style={button} onPress={() => setExclusive(v=>!v)}><Text style={{color:'#fff'}}>Booking: {exclusive ? 'Whole table (fixed guest capacity)' : 'Individual seats'} · tap to change</Text></TouchableOpacity>
    {!!message && <Text accessibilityRole="alert" style={{ color: '#ffaaaa', marginTop: 10 }}>{message}</Text>}
    <TouchableOpacity disabled={busy} onPress={() => save()} style={button}><Text style={{ color: '#fff' }}>{busy ? 'Saving…' : 'Save table'}</Text></TouchableOpacity>
    {editing && <TouchableOpacity onPress={() => { setVisible(true); setEditing(null); setName(''); setSeats(''); setPrice(''); }} style={button}><Text style={{ color: '#fff' }}>Cancel edit</Text></TouchableOpacity>}
    <Text style={{ color: '#fff', fontSize: 19, marginTop: 24 }}>Paid reservations</Text>
    {!bookings.length && <Text style={{ color: '#ccc', marginTop: 8 }}>No paid reservations yet.</Text>}
    {bookings.map(b => <Text key={b.id} style={{ color: '#ddd', marginTop: 10 }}>{b.table_name} · {b.seats} seats · {b.guest_email} · {(b.seats * Number(b.unit_price)).toFixed(2)} {b.currency}</Text>)}
    <TouchableOpacity onPress={load} style={button}><Text style={{ color: '#fff' }}>Refresh reservations</Text></TouchableOpacity>
  </View>;
}
