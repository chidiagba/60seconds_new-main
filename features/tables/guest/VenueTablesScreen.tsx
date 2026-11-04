import BookingDateInput from '../BookingDateInput';
// Guest: the tables a venue offers, shown on the venue page or its own screen.
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { FloorPlan } from '../FloorPlan';
import { useFocusEffect } from '@react-navigation/native';
import { Alert, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '../router';
import { errorMessage, listVenueTables, getBusyRanges, isSlotTaken } from '../api';
import { buildBookableDays, buildSlotsForNight, dayLabel, timeLabel, money, withinBookingWindow } from '../format';
import type { TablesStackParamList } from '../navigation';
import type { BusyRange, VenueTable } from '../types';
import { Button, Chip, Empty, ImageCarousel, Loading, colors, s } from '../ui';

type Props = NativeStackScreenProps<TablesStackParamList, 'VenueTables'>;

export default function VenueTablesScreen({ route, navigation }: Props) {
  const { purchased, cancelled } = useLocalSearchParams();
  const { venueId, venueName } = route.params;
  const [tables, setTables] = React.useState<VenueTable[] | null>(null);
  const days = React.useMemo(() => buildBookableDays(), []);
  const [day, setDay] = React.useState(days[0]);
  const [slot, setSlot] = React.useState<Date | null>(null);
  const [selected, setSelected] = React.useState<string>();
  const [busy, setBusy] = React.useState<BusyRange[]>([]);
  const [availabilityReady, setAvailabilityReady] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: venueName ? `Tables at ${venueName}` : 'Reserve a table' });
  }, [navigation, venueName]);

  const load = React.useCallback(async () => {
    setAvailabilityReady(false);
    try {
      const to = new Date(days[days.length - 1]); to.setDate(to.getDate() + 2);
      setBusy(await getBusyRanges(venueId, day < days[0] ? day : days[0], new Date(Math.max(to.getTime(),day.getTime()+2*86400000))));
      setAvailabilityReady(true);
      // RLS already hides inactive tables from guests; the filter keeps a
      // venue owner previewing their own page seeing the guest view.
      setTables((await listVenueTables(venueId)).filter((t) => t.is_active));
    } catch (e) {
      Alert.alert('Could not load tables', errorMessage(e));
      setTables((t) => t ?? []);
    }
  }, [venueId, days, day]);

  useFocusEffect(React.useCallback(() => { load(); }, [load]));

  if (!tables) return <Loading />;

  const unavailable = tables.filter(t => !availabilityReady || (slot && (!withinBookingWindow(t, slot) || isSlotTaken(t.id, slot, t.booking_duration_minutes, busy)))).map(t => t.id);
  const chosen = tables.find(t => t.id === selected);
  return (
    <FlatList
      style={s.screen}
      data={tables}
      keyExtractor={(t) => t.id}
      contentContainerStyle={[{ paddingVertical: 16 }, !tables.length && { flex: 1 }]}
      refreshControl={
        <RefreshControl
          tintColor={colors.accent}
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
      ListHeaderComponent={tables.length ? <View style={s.pad}>
        <Text style={s.h1}>Choose your table</Text>
        <BookingDateInput onChange={d=>{setDay(d);setSlot(null);setSelected(undefined);}} />
        {purchased === '1' && <Text style={s.muted}>Payment is being verified. We will email your booking confirmation after payment is confirmed.</Text>}
        {cancelled === '1' && <Text style={s.muted}>Checkout cancelled. Your booking is unconfirmed; the temporary hold expires automatically.</Text>}
        <Text style={s.muted}>Select a night and arrival time to see availability. Times use your device’s time zone.</Text>
        <ScrollView horizontal style={{ marginVertical: 12 }}>{days.map(d => <Chip key={d.toISOString()} label={dayLabel(d)} selected={d === day} onPress={() => { setDay(d); setSlot(null); setSelected(undefined); }} />)}</ScrollView>
        <ScrollView horizontal style={{ marginBottom: 16 }}>{buildSlotsForNight(day).map(d => <Chip key={d.toISOString()} label={timeLabel(d)} selected={slot?.getTime() === d.getTime()} onPress={() => { setSlot(d); setSelected(undefined); }} />)}</ScrollView>
        {!availabilityReady && <Text style={s.muted}>Availability could not be loaded. Pull down to retry.</Text>}
        <FloorPlan tables={tables} selected={selected} unavailable={unavailable} onSelect={t => setSelected(t.id)} />
        {chosen && <View style={s.card}><View style={s.pad}>
          <Text style={s.h2}>{chosen.name}</Text>
          <Text style={s.body}>{chosen.min_guests}–{chosen.max_guests} guests · {money(chosen.minimum_spend, chosen.currency) ?? 'No minimum spend'}</Text>
          <Button title={slot ? 'Continue with this table' : 'Select an arrival time'} disabled={!slot || unavailable.includes(chosen.id)} onPress={() => navigation.navigate('BookTable', { tableId: chosen.id, startsAt: slot?.toISOString() })} />
        </View></View>}
        <Text style={s.h2}>Table details</Text>
      </View> : null}
      ListEmptyComponent={<Empty title="No tables to book" body="This venue hasn't listed any tables yet." />}
      renderItem={({ item: t }) => {
        const spend = money(t.minimum_spend, t.currency);
        return (
          <View style={[s.card, { marginHorizontal: 0, borderRadius: 0, borderLeftWidth: 0, borderRightWidth: 0 }]}>
            <ImageCarousel images={t.images} />
            <Pressable style={{ padding: 16 }} onPress={() => navigation.navigate('BookTable', { tableId: t.id })}>
              <Text style={s.h2}>{t.name}</Text>
              {t.location ? <Text style={[s.muted, { marginTop: 2 }]}>{t.location}</Text> : null}
              <Text style={[s.body, { marginTop: 8 }]}>
                {t.min_guests}–{t.max_guests} guests{spend ? ` · Min. spend ${spend}` : ''}
              </Text>
              {t.description ? (
                <Text style={[s.muted, { marginTop: 6 }]} numberOfLines={2}>
                  {t.description}
                </Text>
              ) : null}
              <Button
                title={t.requires_approval ? 'Request this table' : 'Book this table'}
                onPress={() => navigation.navigate('BookTable', { tableId: t.id })}
                style={{ marginTop: 14 }}
              />
            </Pressable>
          </View>
        );
      }}
    />
  );
}
