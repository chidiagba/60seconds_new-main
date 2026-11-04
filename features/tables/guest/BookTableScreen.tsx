import BookingDateInput from '../BookingDateInput';
// Guest: table details, pick night / time / party size, then book.
import React from 'react';
import { Alert, Linking, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { markedPrice } from '@/utils/commerce-rules';
import type { NativeStackScreenProps } from '../router';
import { errorMessage, getBusyRanges, getVenueTable, isSlotTaken, reserveTable } from '../api';
import { buildBookableDays, buildSlotsForNight, dayLabel, money, timeLabel, withinBookingWindow } from '../format';
import type { TablesStackParamList } from '../navigation';
import type { BusyRange, VenueTable } from '../types';
import { Button, Chip, ImageCarousel, Loading, Stepper, colors, s } from '../ui';

type Props = NativeStackScreenProps<TablesStackParamList, 'BookTable'>;

export default function BookTableScreen({ route, navigation }: Props) {
  const { tableId, startsAt } = route.params;
  const { user, profile } = useAuth();
  const [name, setName] = React.useState(profile?.full_name || '');
  const [email, setEmail] = React.useState(user?.email || '');
  const days = React.useMemo(() => buildBookableDays(), []);
  const [table, setTable] = React.useState<VenueTable | null>(null);
  const [availabilityReady, setAvailabilityReady] = React.useState(false);
  const [busy, setBusy] = React.useState<BusyRange[]>([]);
  const [day, setDay] = React.useState(days[0]);
  const [slot, setSlot] = React.useState<Date | null>(null);
  const [party, setParty] = React.useState(2);
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const loadBusy = React.useCallback(async (t: VenueTable) => {
    const from = day;
    const to = new Date(day);
    to.setDate(to.getDate() + 2);
    setBusy(await getBusyRanges(t.venue_id, from, to));
  }, [day]);

  React.useEffect(() => {
    getVenueTable(tableId)
      .then(async (t) => {
        setTable(t);
        setParty(Math.max(t.min_guests, Math.min(2, t.max_guests)));
        navigation.setOptions({ title: t.name });
        if (startsAt && Number.isFinite(Date.parse(startsAt))) {
          const initial = new Date(startsAt);
          const night = new Date(initial);
          night.setHours(0, 0, 0, 0);
          const matchingDay = days.find(d => d.getTime() === night.getTime()) || night;
          if (matchingDay) { setDay(matchingDay); setSlot(initial); }
        }
      })
      .catch((e) => {
        Alert.alert('Table unavailable', errorMessage(e));
        navigation.goBack();
      });
  }, [tableId, startsAt, days, navigation]);

  React.useEffect(() => {
    if (!table) return;
    let active = true;
    setAvailabilityReady(false);
    const to = new Date(day); to.setDate(to.getDate()+2);
    getBusyRanges(table.venue_id, day, to).then(ranges=>{
      if (active) { setBusy(ranges); setAvailabilityReady(true); }
    }).catch(e=>{ if (active) Alert.alert('Could not load availability', errorMessage(e)); });
    return () => { active = false; };
  }, [table?.venue_id, day]);

  if (!table) return <Loading />;

  const slots = buildSlotsForNight(day);
  const free = (d: Date) => availabilityReady && withinBookingWindow(table, d) && !isSlotTaken(table.id, d, table.booking_duration_minutes, busy);
  const nightHasFreeSlot = (d: Date) => buildSlotsForNight(d).some(free);
  const spend = money(table.minimum_spend, table.currency);
  const deposit = money(table.deposit_amount, table.currency);

  async function submit() {
    if (!table || !slot || submitting || !free(slot) || slot.getTime() <= Date.now()) return;
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { Alert.alert('Booking details', 'Enter your name and a valid email.'); return; }
    setSubmitting(true);
    try {
      const url = await reserveTable({ tableId: table.id, startsAt: slot, partySize: party, name: name.trim(), email: email.trim(), note });
      if (Platform.OS === 'web') window.location.assign(url);
      else {
        await Linking.openURL(url);
        Alert.alert('Complete your payment', 'Your table is confirmed only after payment. Check My reservations after checkout.');
      }
    } catch (e) {
      Alert.alert('Could not book', errorMessage(e));
      await loadBusy(table).catch(() => undefined);
      setSlot(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <ImageCarousel images={table.images} height={260} />
        <View style={s.pad}>
          <Text style={s.h1}>{table.name}</Text>
          {table.location ? <Text style={[s.muted, { marginTop: 2 }]}>{table.location}</Text> : null}
          <Text style={[s.body, { marginTop: 10 }]}>
            {table.min_guests}–{table.max_guests} guests · {table.booking_duration_minutes / 60} h
            {spend ? ` · Min. spend ${spend}` : ''}
          </Text>
          {(deposit || spend) ? <Text style={[s.muted, { marginTop: 4 }]}>Booking payment {money(markedPrice(Number(table.deposit_amount || table.minimum_spend || 0), table.currency), table.currency)} including platform fee</Text> : null}
          {table.description ? <Text style={[s.body, { marginTop: 12, color: colors.muted }]}>{table.description}</Text> : null}

          <Text style={s.muted}>Times are shown in your device’s time zone.</Text>
          <BookingDateInput onChange={d=>{setDay(d);setSlot(null);}} />
          <Text style={s.label}>Date</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
          {days.map((d) => (
            <Chip
              key={d.toISOString()}
              label={dayLabel(d)}
              selected={d === day}
              disabled={!nightHasFreeSlot(d)}
              onPress={() => {
                setDay(d);
                setSlot(null);
              }}
            />
          ))}
        </ScrollView>

        <View style={s.pad}>
          <Text style={[s.label, { marginTop: 4 }]}>Arrival time</Text>
          {slots.length ? (
            <View style={[s.row, { flexWrap: 'wrap' }]}>
              {slots.map((d) => (
                <Chip
                  key={d.toISOString()}
                  label={timeLabel(d)}
                  selected={slot?.getTime() === d.getTime()}
                  disabled={!free(d)}
                  onPress={() => setSlot(d)}
                />
              ))}
            </View>
          ) : (
            <Text style={s.muted}>No more times tonight — pick another night.</Text>
          )}

          <Text style={s.label}>Name *</Text>
          <TextInput accessibilityLabel="Booking name" style={s.input} value={name} onChangeText={setName} maxLength={120} />
          <Text style={s.label}>Email *</Text>
          <TextInput accessibilityLabel="Booking email" style={s.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" maxLength={254} />
          <Text style={s.muted}>We will email your confirmation after payment.</Text>
          <Text style={s.label}>Guests</Text>
          <Stepper value={party} min={table.min_guests} max={table.max_guests} onChange={setParty} />

          <Text style={s.label}>Note for the venue</Text>
          <TextInput
            style={[s.input, { minHeight: 70, textAlignVertical: 'top' }]}
            value={note}
            onChangeText={setNote}
            placeholder="Birthday, bottle preferences, arrival details…"
            placeholderTextColor={colors.muted}
            multiline
            maxLength={500}
          />
        </View>
      </ScrollView>

      <View style={s.footer}>
        <Button
          title={
            slot
              ? `Continue to payment · ${dayLabel(day)} ${timeLabel(slot)} · ${party}`
              : 'Pick an arrival time'
          }
          onPress={submit}
          disabled={!slot || !free(slot) || slot.getTime() <= Date.now()}
          loading={submitting}
        />
      </View>
    </View>
  );
}
