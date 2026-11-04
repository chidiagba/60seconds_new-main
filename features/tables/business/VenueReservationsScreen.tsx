// Business: booking inbox for one night — confirm, decline, check in, no-show.
import React from 'react';
import { Alert, FlatList, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '../router';
import {
  errorMessage,
  listVenueReservations,
  setReservationStatus,
  subscribeToVenueReservations,
} from '../api';
import { buildBookableDays, dayLabel, timeLabel } from '../format';
import type { TablesStackParamList } from '../navigation';
import { STATUS_LABEL, type ReservationStatus, type ReservationWithTable } from '../types';
import { Button, Chip, Empty, Loading, StatusBadge, colors, s } from '../ui';

type Props = NativeStackScreenProps<TablesStackParamList, 'VenueReservations'>;

/** A "night" runs from noon on the chosen day to noon the next day. */
function nightWindow(day: Date): [Date, Date] {
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12);
  const to = new Date(from);
  to.setDate(from.getDate() + 1);
  return [from, to];
}

export default function VenueReservationsScreen({ route, navigation }: Props) {
  const { venueId } = route.params;
  const days = React.useMemo(() => buildBookableDays(new Date(), 14), []);
  const [day, setDay] = React.useState(days[0]);
  const [onlyRequests, setOnlyRequests] = React.useState(false);
  const [items, setItems] = React.useState<ReservationWithTable[] | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  React.useLayoutEffect(() => navigation.setOptions({ title: 'Bookings' }), [navigation]);

  const load = React.useCallback(async () => {
    try {
      const [from, to] = nightWindow(day);
      setItems(await listVenueReservations(venueId, from, to));
    } catch (e) {
      Alert.alert('Could not load bookings', errorMessage(e));
      setItems((x) => x ?? []);
    }
  }, [venueId, day]);

  React.useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  React.useEffect(() => subscribeToVenueReservations(venueId, load), [venueId, load]);

  async function act(r: ReservationWithTable, status: ReservationStatus) {
    setBusyId(r.id);
    try {
      await setReservationStatus(r.id, status);
      await load();
    } catch (e) {
      Alert.alert('Could not update booking', errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  function confirmThen(r: ReservationWithTable, status: ReservationStatus, title: string) {
    Alert.alert(title, `${r.table?.name ?? 'Table'} · ${timeLabel(new Date(r.starts_at))} · ${r.party_size} guests`, [
      { text: 'Back', style: 'cancel' },
      { text: title, style: 'destructive', onPress: () => act(r, status) },
    ]);
  }

  const shown = (items ?? []).filter((r) => !onlyRequests || r.status === 'pending');
  const pendingCount = (items ?? []).filter((r) => r.status === 'pending').length;

  return (
    <View style={s.screen}>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12 }}>
          {days.map((d) => (
            <Chip key={d.toISOString()} label={dayLabel(d)} selected={d === day} onPress={() => setDay(d)} />
          ))}
        </ScrollView>
        <View style={[s.row, { paddingHorizontal: 16 }]}>
          <Chip label="All" selected={!onlyRequests} onPress={() => setOnlyRequests(false)} />
          <Chip label={`Requests${pendingCount ? ` (${pendingCount})` : ''}`} selected={onlyRequests} onPress={() => setOnlyRequests(true)} />
        </View>
      </View>

      {!items ? (
        <Loading />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(r) => r.id}
          contentContainerStyle={[s.pad, !shown.length && { flex: 1 }]}
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
          ListEmptyComponent={<Empty title="No bookings" body={onlyRequests ? 'No requests waiting for this night.' : 'Nothing booked for this night yet.'} />}
          renderItem={({ item: r }) => (
            <View style={[s.card, { padding: 14 }]}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={s.h2}>{timeLabel(new Date(r.starts_at))} – {timeLabel(new Date(r.ends_at))}</Text>
                <StatusBadge status={r.status} label={STATUS_LABEL[r.status]} />
              </View>
              <Text style={[s.body, { marginTop: 4 }]}>
                {r.table?.name ?? 'Table'} · {r.party_size} guests
              </Text>
              {r.guest_note ? <Text style={[s.muted, { marginTop: 6 }]}>“{r.guest_note}”</Text> : null}

              {r.order_id && <Text style={s.muted}>{r.guest_name} · {r.guest_email}{r.status === 'pending' ? ' · Awaiting payment' : ''}</Text>}
              {r.status === 'pending' && !r.order_id && (
                <View style={[s.row, { marginTop: 12, gap: 10 }]}>
                  <Button title="Confirm" onPress={() => act(r, 'confirmed')} loading={busyId === r.id} style={{ flex: 1, height: 42 }} />
                  <Button title="Decline" variant="secondary" onPress={() => confirmThen(r, 'declined', 'Decline')} disabled={busyId === r.id} style={{ flex: 1, height: 42 }} />
                </View>
              )}
              {r.status === 'confirmed' && (
                <View style={[s.row, { marginTop: 12, gap: 10 }]}>
                  <Button title="Arrived" onPress={() => act(r, 'completed')} loading={busyId === r.id} style={{ flex: 1, height: 42 }} />
                  <Button title="No-show" variant="secondary" onPress={() => confirmThen(r, 'no_show', 'Mark no-show')} disabled={busyId === r.id} style={{ flex: 1, height: 42 }} />
                  {!r.order_id && <Button title="Cancel" variant="danger" onPress={() => confirmThen(r, 'cancelled', 'Cancel booking')} disabled={busyId === r.id} style={{ height: 42 }} />}
                </View>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}
