import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '@/lib/supabase';
import QRCode from 'react-native-qrcode-svg';

export default function PaidReservations() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error('Sign in with your booking email to see your reservations.');
      if (!auth.user.email_confirmed_at) throw new Error('Verify your email to see reservations made with that address.');
      const { data, error } = await supabase.from('event_table_bookings')
        .select('*, event:events(event_name,start_date,location_name)')
        .eq('guest_email', auth.user.email!.toLowerCase()).eq('state', 'confirmed').order('created_at', { ascending: false });
      if (error) throw error;
      const {data: venue,error: venueError} = await supabase.from('table_reservations').select('*,venue:profiles!table_reservations_venue_id_fkey(business_name)').eq('guest_id',auth.user.id).not('order_id','is',null).eq('status','confirmed').order('starts_at');
      if (venueError) throw venueError;
      setItems([...(data || []), ...(venue || []).map(b=>({...b,seats:b.party_size,unit_price:Number(b.paid_amount)/b.party_size,qr_code:`RESERVATION:${b.id}`,event:{event_name:b.venue?.business_name || 'Business',start_date:b.starts_at}}))]);
    } catch (e: any) { setError(e.message || 'Unable to load reservations'); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return <ScrollView style={{ flex: 1, backgroundColor: '#111' }} contentContainerStyle={{ padding: 24 }}>
    <Text style={{ color: '#fff', fontSize: 26, fontWeight: 'bold' }}>My table reservations</Text>
    <Text style={{ color: '#ccc', marginVertical: 16 }}>Book a table from a business profile or reserve seats from an event page. Reservations appear here after payment, using your verified booking email.</Text>
    {loading && <ActivityIndicator />}
    {!!error && <Text accessibilityRole="alert" style={{ color: '#ffaaaa' }}>{error}</Text>}
    {!loading && !error && !items.length && <Text style={{ color: '#fff' }}>No paid table reservations yet.</Text>}
    {items.map(b => <View key={b.id} style={{ padding: 20, backgroundColor: '#232331', borderRadius: 12, marginBottom: 16 }}>
      <Text style={{ color: '#fff', fontSize: 20 }}>{b.event?.event_name || 'Event'} · {b.table_name}</Text>
      <Text style={{ color: '#afa', marginVertical: 10 }}>Confirmed · {b.seats} seats</Text>
      <Text style={{ color: '#ddd', marginBottom: 12 }}>{b.event?.start_date ? new Date(b.event.start_date).toLocaleString() : ''} · {b.event?.location_name}</Text>
      <Text style={{ color: '#ddd', marginBottom: 12 }}>Paid {(Number(b.unit_price) * b.seats).toFixed(2)} {b.currency}</Text>
      <QRCode value={b.qr_code} size={150} />
      <Text selectable style={{ color: '#ccc', marginTop: 12 }}>Reservation {b.id}</Text>
    </View>)}
    <TouchableOpacity onPress={load} style={{ padding: 16, backgroundColor: '#4338ca', borderRadius: 8 }}><Text style={{ color: '#fff' }}>Refresh</Text></TouchableOpacity>
  </ScrollView>;
}
