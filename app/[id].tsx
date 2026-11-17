import NativeShare from '@/lib/native-share';
import EventTableManager from '@/features/event-tables/EventTableManager';
import { markedPrice, currencyDigits } from '@/utils/commerce-rules';
import React, { useEffect, useRef, useState } from 'react';
import { uuid } from 'expo-modules-core';
import CheckoutPaymentMethod from '@/components/CheckoutPaymentMethod';
import { webPaymentOptions, validWebAttempt, WebBuyerRegion, WebMethod } from '@/utils/web-payment-methods';
import { ActivityIndicator, Alert, Image, Linking, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { buildEventShareUrl } from '@/constants/app-links';
import { resolveEventCurrency } from '@/utils/country-currency';
import { Video, ResizeMode } from 'expo-av';

export default function SharedEventPage() {
  const { id, purchased, cancelled, attempt: returnAttempt } = useLocalSearchParams<{ id: string; purchased?: string; cancelled?: string; attempt?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [event, setEvent] = useState<any>(null);
  const [tables, setTables] = useState<any[]>([]);
  const [seatCounts, setSeatCounts] = useState<Record<string, number>>({});
  const [revision, setRevision] = useState(0);
  const [products, setProducts] = useState<any[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [buyerRegion, setBuyerRegion] = useState<WebBuyerRegion>('NG');
  const [paymentMethod, setPaymentMethod] = useState<WebMethod>('paystack_card');
  const [attemptKey, setAttemptKey] = useState<string | null>(null);
  const [paymentState, setPaymentState] = useState<'reserved' | 'paid' | 'released' | null>(null);
  const [resumeUrl, setResumeUrl] = useState<string | null>(null);
  const busyRef = useRef(false);
  const currentEventId = useRef(id);
  currentEventId.current = id;
  const paymentOptions = webPaymentOptions(buyerRegion, event?.currency || 'NGN');
  const selectedMethod = paymentOptions.some(option => option.id === paymentMethod) ? paymentMethod : paymentOptions[0].id;
  const pendingAttempt = !!attemptKey && paymentState !== 'paid' && paymentState !== 'released';
  const storageKey = `60seconds-web-checkout:${id}`;
  useEffect(() => {
    setAttemptKey(null); setPaymentState(null); setResumeUrl(null);
    if (validWebAttempt(returnAttempt)) setAttemptKey(returnAttempt);
    else if (Platform.OS === 'web') {
      try {
        const saved = window.sessionStorage.getItem(storageKey);
        if (validWebAttempt(saved)) setAttemptKey(saved);
      } catch { /* Storage-disabled browsers still use the return URL. */ }
    }
  }, [returnAttempt, storageKey]);
  const checkPaymentStatus = async (key = attemptKey) => {
    if (!key || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const { data, error } = await supabase.functions.invoke('guest-event', { body: { action: 'checkout-status', eventId: id, requestKey: key } });
      if (currentEventId.current !== id) return;
      if (error || data?.error) throw new Error(data?.error || 'Unable to check payment status. Please try again.');
      setPaymentState(data.state);
      setResumeUrl(data.url || null);
      setNotice(data.state === 'paid'
        ? (data.emailSent ? 'Payment confirmed. Your purchase and QR codes have been emailed to you.' : 'Payment confirmed. Your QR code email is being prepared.')
        : data.state === 'released' ? 'This checkout expired or failed. No purchase was confirmed. You can start again.'
        : 'Payment is pending. Resume the existing payment or check again after paying.');
    } catch (error: any) { setError(error.message || 'Unable to check payment status.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  useEffect(() => {
    if (attemptKey) void checkPaymentStatus(attemptKey);
  }, [attemptKey]);
  const openCheckout = async (url: string) => {
    if (!/^https:\/\/checkout\.(stripe|paystack)\.com\//.test(url)) throw new Error('Checkout unavailable');
    if (Platform.OS === 'web') window.location.assign(url);
    else await Linking.openURL(url);
  };
  const resetCheckout = () => {
    if (paymentState !== 'paid' && paymentState !== 'released') return;
    setAttemptKey(null); setPaymentState(null); setResumeUrl(null); setNotice('');
    setQuantities({}); setSeatCounts({});
    if (Platform.OS === 'web') try { window.sessionStorage.removeItem(storageKey); } catch {}
    router.setParams({ attempt: undefined, purchased: undefined, cancelled: undefined });
    setRevision(value => value + 1);
  };
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setEvent(null); setProducts([]); setTables([]); setQuantities({}); setSeatCounts({});
    (async () => {
      const { data, error: invokeError } = await supabase.functions.invoke('guest-event', { body: { eventId: id } });
      if (!active) return;
      if (invokeError || data?.error) {
        // Preserve historical /video-id links.
        const { data: video } = await supabase.from('videos').select('id').eq('id', id).maybeSingle();
        if (!active) return;
        if (video) { router.replace({ pathname: '/video/[id]', params: { id } }); return; }
        let message = data?.error;
        try { message ||= (await (invokeError as any)?.context?.json())?.error; } catch {}
        setError(message || 'This event is unavailable or its link has expired.');
      } else {
        // Older events were saved with USD even when all their offers use NGN.
        const offers = data.products || [];
        const currency = resolveEventCurrency(offers, data.event.currency);
        setEvent({ ...data.event, currency }); setProducts(offers); setTables(data.tables || []);
      }
      setLoading(false);
    })().catch(() => { if (active) { setError('Unable to load event. Please try again.'); setLoading(false); } });
    return () => { active = false; };
  }, [id, revision]);
  useEffect(() => {
    let active = true;
    setCanEdit(false);
    if (user?.id && event && [event.user_id,event.business_id].includes(user.id)) {
      supabase.from('profiles').select('user_type').eq('id',user.id).single().then(({data}) => { if (active) setCanEdit(data?.user_type === 'business'); });
    }
    return () => { active = false; };
  }, [user?.id,event]);
  const shareEvent = async () => {
    try {
      await NativeShare.open({title:event?.event_name, message:'Book tickets, products and table seats', url:buildEventShareUrl(id)});
      if (Platform.OS === 'web' && !navigator.share) setNotice('Event link copied.');
    } catch (e: any) { if (e.name !== 'AbortError' && !String(e.message).toLowerCase().includes('cancel')) setError(e.message || 'Unable to share event'); }
  };
  const checkout = async () => {
    if (busyRef.current || pendingAttempt) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid email address for your order and QR codes.'); return; }
    const items = Object.entries(quantities).filter(([,q]) => q > 0).map(([id,quantity]) => ({id,quantity}));
    const selectedTables = Object.entries(seatCounts).filter(([,q]) => q > 0).map(([id,quantity]) => ({id,quantity}));
    if (!items.length && !selectedTables.length) { setError('Select tickets, products or table seats first.'); return; }
    const requestKey = uuid.v4();
    busyRef.current = true; setBusy(true); setError(''); setAttemptKey(requestKey); setPaymentState('reserved');
    if (Platform.OS === 'web') try { window.sessionStorage.setItem(storageKey, requestKey); } catch {}
    try {
      const result = await supabase.functions.invoke('guest-event',{body:{action:'checkout',eventId:id,email:email.trim(),items,tables:selectedTables,
        requestKey, buyerRegion, paymentMethod:selectedMethod}});
      let data = result.data;
      if (result.error) {
        try { data = await (result.error as any).context?.json(); } catch {}
      }
      if (result.error || data?.error) {
        if (data?.reserved === false) {
          setAttemptKey(null); setPaymentState(null);
          if (Platform.OS === 'web') try { window.sessionStorage.removeItem(storageKey); } catch {}
        }
        throw new Error(data?.error || 'Checkout initialization is uncertain. Check payment status before paying again.');
      }
      if (data.completed) { setPaymentState('paid'); setNotice('Payment confirmed. Your purchase is being delivered by email.'); return; }
      setResumeUrl(data.url);
      await openCheckout(data.url);
    } catch (error: any) { setError(error.message || 'Unable to open checkout. Check payment status before retrying.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const total = products.reduce((sum,p) => sum + markedPrice(Number(p.price),event?.currency)*(quantities[p.id] || 0),0) + tables.reduce((sum,t) => sum + markedPrice(Number(t.seat_price),event?.currency)*(seatCounts[t.id] || 0),0);
  const bookable = event && ['open','published'].includes(event.status) && Date.now() < Date.parse(event.end_date || event.start_date);
  const button = { padding: 14, backgroundColor: '#ed365b', borderRadius: 8, marginTop: 12 } as const;
  const close = () => router.canGoBack() ? router.back() : router.replace('/(tabs)');
  if (loading) return <View style={{flex:1,paddingTop:60}}><TouchableOpacity accessibilityRole="button" onPress={close} style={{padding:20}}><Text>Close event</Text></TouchableOpacity><ActivityIndicator /></View>;
  return <ScrollView style={{flex:1,backgroundColor:'#111'}} contentContainerStyle={{padding:24,maxWidth:720,width:'100%',alignSelf:'center',paddingBottom:80}}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close event" onPress={close} style={{paddingVertical:16}}><Text style={{color:"#fff",fontSize:18}}>✕ Close event</Text></TouchableOpacity>
    <Text style={{color:'#fff',fontSize:30,fontWeight:'bold'}}>60seconds</Text>
    {purchased === '1' && <Text style={{color:'#8f8',marginTop:16}}>Returned from checkout. Use Check payment status below to verify payment. Your purchase is confirmed only after provider verification.</Text>}
    {cancelled === '1' && <Text style={{color:'#ddd',marginTop:16}}>Checkout was cancelled. No reservation is confirmed without payment. Seats held by checkout become available after it expires.</Text>}
    {!!notice && <Text style={{color:'#afa',marginTop:16}}>{notice}</Text>}
    {!!error && <Text accessibilityRole="alert" style={{color:'#ff9a9a',marginVertical:16}}>{error}</Text>}
    {event && <>
      <Text style={{color:'#fff',fontSize:26,marginTop:24}}>{event.event_name}</Text>
      {!!event.image_url && <Image source={{uri:event.image_url}} style={{width:'100%',height:300,marginTop:16}} resizeMode="contain" />}
      {!!event.video?.video_url && <Video source={{uri:event.video.video_url}} style={{width:'100%',height:300,marginTop:16}} resizeMode={ResizeMode.CONTAIN} useNativeControls shouldPlay={false} />}
      <Text style={{color:'#ddd',marginVertical:16}}>{event.description}</Text>
      <Text style={{color:'#ddd'}}>{new Date(event.start_date).toLocaleString()} · {event.location_name}</Text>
      <TouchableOpacity style={button} onPress={shareEvent}><Text style={{color:'#fff'}}>Share event</Text></TouchableOpacity>
      {canEdit && <TouchableOpacity disabled={busy || pendingAttempt} style={button} onPress={() => router.push({ pathname: '/edit-event-media' as any, params: { id } })}><Text style={{color:'#fff'}}>Edit event images & video</Text></TouchableOpacity>}
      {!bookable && <Text style={{color:'#ffaaaa',marginTop:16}}>Bookings are closed for this event.</Text>}
      <Text style={{color:'#fff',fontSize:22,marginTop:24}}>Tickets, drinks & other offers</Text>
      {!products.length && <Text style={{color:'#ccc',marginTop:12}}>No tickets, drinks or other offers are listed for this event.</Text>}
      {products.map(p => <View key={p.id} style={{paddingVertical:20,borderBottomWidth:1,borderBottomColor:'#444'}}>
        <Text style={{color:'#fff',fontSize:18}}>{p.name}</Text>
        <Text style={{color:'#aaa'}}>{p.type === 'ticket' ? 'Ticket' : p.type === 'drink' ? 'Drink' : p.type === 'reservation' ? 'Table / reservation offer' : 'Other offer'}</Text>
        <Text style={{color:'#ccc'}}>{(markedPrice(Number(p.price),event.currency)).toFixed(currencyDigits(event.currency))} {event.currency} · {p.available_quantity > 0 ? `${p.available_quantity} available` : 'Sold out'}</Text>
        <View style={{flexDirection:'row',alignItems:'center',gap:20,marginTop:8}}>
          <TouchableOpacity accessibilityLabel={`Remove ${p.name}`} disabled={busy || pendingAttempt || !bookable} onPress={() => setQuantities(q => ({...q,[p.id]:Math.max(0,(q[p.id]||0)-1)}))}><Text style={{color:'#fff',fontSize:28}}>−</Text></TouchableOpacity>
          <Text style={{color:'#fff'}}>{quantities[p.id] || 0}</Text>
          <TouchableOpacity accessibilityLabel={`Add ${p.name}`} disabled={busy || pendingAttempt || !bookable} onPress={() => setQuantities(q => ({...q,[p.id]:Math.min(20,p.available_quantity,(q[p.id]||0)+1)}))}><Text style={{color:'#fff',fontSize:28}}>+</Text></TouchableOpacity>
        </View>
      </View>)}
      <Text style={{color:'#fff',fontSize:22,marginTop:24}}>Book a table</Text>
      <Text style={{color:'#ccc',marginTop:8}}>Whole tables include the guest capacity shown. Individual-seat offers are labelled per seat. Prices include the 4% platform fee. Bookings are confirmed after payment.</Text>
      {!tables.length && <Text style={{color:'#ccc',marginTop:12}}>The owner has not listed tables for this event yet.</Text>}
      {tables.map(t => <View key={t.id} style={{paddingVertical:20,borderBottomWidth:1,borderBottomColor:'#444'}}>
        <Text style={{color:'#fff',fontSize:18}}>{t.name}</Text>
        <Text style={{color:'#ccc'}}>{t.seats} guests · {t.whole_table ? (Number(t.available_seats) === Number(t.seats) ? "Available" : "Booked") : `${t.available_seats} seats available`} · {markedPrice(Number(t.seat_price),event.currency).toFixed(currencyDigits(event.currency))} {event.currency}/{t.whole_table ? "table" : "seat"}</Text>
        <View style={{flexDirection:'row',alignItems:'center',gap:20,marginTop:8}}>
          <TouchableOpacity accessibilityLabel={`Remove seat at ${t.name}`} disabled={busy || pendingAttempt} onPress={() => setSeatCounts(q => ({...q,[t.id]:Math.max(0,(q[t.id]||0)-1)}))}><Text style={{color:'#fff',fontSize:28}}>−</Text></TouchableOpacity>
          <Text style={{color:'#fff'}}>{seatCounts[t.id] || 0}</Text>
          <TouchableOpacity accessibilityLabel={`Add seat at ${t.name}`} disabled={busy || pendingAttempt || !bookable} onPress={() => setSeatCounts(q => ({...q,[t.id]:Math.min(t.whole_table ? (Number(t.available_seats) === Number(t.seats) ? 1 : 0) : Number(t.available_seats),(q[t.id]||0)+1)}))}><Text style={{color:'#fff',fontSize:28}}>+</Text></TouchableOpacity>
        </View>
      </View>)}
      {canEdit && <EventTableManager eventId={id} currency={event.currency} onChange={() => setRevision(n => n+1)} />}
      <Text style={{color:'#fff',marginTop:20}}>Email for your order and QR codes</Text>
      <TextInput editable={!busy && !pendingAttempt} accessibilityLabel="Email for your order" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" style={{backgroundColor:'#fff',padding:14,borderRadius:8,marginTop:8}} />
      <Text style={{color:'#fff',fontSize:18,marginTop:24}}>Where are you paying from?</Text>
      <View accessibilityRole="radiogroup" style={{flexDirection:'row',gap:12,marginTop:12,flexWrap:'wrap'}}>
        {(['NG','OTHER'] as const).map(region => <TouchableOpacity key={region} accessibilityRole="radio"
          accessibilityState={{checked:buyerRegion===region,disabled:busy || pendingAttempt}}
          disabled={busy || pendingAttempt} onPress={() => { setBuyerRegion(region); setPaymentMethod(webPaymentOptions(region,event.currency)[0].id); }}
          style={{padding:14,borderRadius:8,borderWidth:1,borderColor:buyerRegion===region?'#7775ff':'#555',backgroundColor:buyerRegion===region?'#292845':'#191919'}}>
          <Text style={{color:'#fff'}}>{region==='NG'?'Nigeria':'Other country'}</Text>
        </TouchableOpacity>)}
      </View>
      <Text style={{color:'#ccc',marginTop:10}}>Charged in {event.currency}. Your bank may apply conversion charges.</Text>
      {buyerRegion === 'NG' && event.currency !== 'NGN' && <Text style={{color:'#ccc',marginTop:8}}>Paystack is available for NGN payments. This event uses {event.currency}; pay by card with Stripe.</Text>}
      <CheckoutPaymentMethod options={paymentOptions} selected={selectedMethod} onSelect={setPaymentMethod} disabled={busy || pendingAttempt} total={total || 1} />
      {!!attemptKey && <View style={{marginTop:16,padding:16,borderWidth:1,borderColor:'#555',borderRadius:10}}>
        <Text style={{color:'#fff',fontWeight:'700'}}>{paymentState === 'paid' ? 'Payment confirmed' : paymentState === 'released' ? 'Checkout closed' : 'Existing payment attempt'}</Text>
        <TouchableOpacity disabled={busy} style={button} onPress={() => { void checkPaymentStatus(); }}><Text style={{color:'#fff'}}>Check payment status</Text></TouchableOpacity>
        {pendingAttempt && !!resumeUrl && <TouchableOpacity disabled={busy} style={button} onPress={() => { void openCheckout(resumeUrl).catch(() => setError('Unable to open payment. Please try again.')); }}><Text style={{color:'#fff'}}>Resume payment</Text></TouchableOpacity>}
        {(paymentState === 'paid' || paymentState === 'released') && <TouchableOpacity disabled={busy} style={button} onPress={resetCheckout}><Text style={{color:'#fff'}}>Start another purchase</Text></TouchableOpacity>}
      </View>}
      {!attemptKey && <TouchableOpacity disabled={busy || total <= 0 || !bookable} style={[button,{opacity:busy || total <= 0 || !bookable ? 0.5 : 1}]} onPress={checkout}><Text style={{color:'#fff'}}>{busy ? 'Please wait…' : `Pay ${total.toFixed(currencyDigits(event.currency))} ${event.currency} · ${selectedMethod.startsWith('paystack')?'Paystack':'Stripe'}`}</Text></TouchableOpacity>}

    </>}
    <TouchableOpacity style={{paddingVertical:20}} onPress={() => router.push('/signup')}><Text style={{color:'#ff809a'}}>Create a 60seconds account</Text></TouchableOpacity>
  </ScrollView>;
}
