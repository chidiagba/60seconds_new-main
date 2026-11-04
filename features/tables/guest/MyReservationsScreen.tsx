// Guest: upcoming and past table reservations, with cancel.
import React from 'react';
import { Alert, RefreshControl, SectionList, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '../router';
import { errorMessage, listMyReservations, setReservationStatus } from '../api';
import { dateTimeLabel } from '../format';
import type { TablesStackParamList } from '../navigation';
import { STATUS_LABEL, type ReservationWithTable } from '../types';
import { Button, Empty, Loading, StatusBadge, colors, s } from '../ui';

type Props = NativeStackScreenProps<TablesStackParamList, 'MyReservations'>;

export default function MyReservationsScreen({ navigation }: Props) {
  const [items, setItems] = React.useState<ReservationWithTable[] | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [cancelling, setCancelling] = React.useState<string | null>(null);

  React.useLayoutEffect(() => navigation.setOptions({ title: 'My reservations' }), [navigation]);

  const load = React.useCallback(async () => {
    try {
      setItems(await listMyReservations());
    } catch (e) {
      Alert.alert('Could not load reservations', errorMessage(e));
      setItems((x) => x ?? []);
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load]),
  );

  function cancel(r: ReservationWithTable) {
    Alert.alert('Cancel reservation?', `${r.table?.name ?? 'Table'} at ${r.venue?.name ?? 'the venue'}, ${dateTimeLabel(r.starts_at)}`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel reservation',
        style: 'destructive',
        onPress: async () => {
          setCancelling(r.id);
          try {
            await setReservationStatus(r.id, 'cancelled');
            await load();
          } catch (e) {
            Alert.alert('Could not cancel', errorMessage(e));
          } finally {
            setCancelling(null);
          }
        },
      },
    ]);
  }

  if (!items) return <Loading />;

  const now = Date.now();
  const isUpcoming = (r: ReservationWithTable) =>
    new Date(r.ends_at).getTime() > now && (r.status === 'pending' || r.status === 'confirmed');
  const upcoming = items.filter(isUpcoming).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = items.filter((r) => !isUpcoming(r));
  const sections = [
    ...(upcoming.length ? [{ title: 'Upcoming', data: upcoming }] : []),
    ...(past.length ? [{ title: 'Past', data: past }] : []),
  ];

  return (
    <SectionList
      style={s.screen}
      sections={sections}
      keyExtractor={(r) => r.id}
      contentContainerStyle={[s.pad, !sections.length && { flex: 1 }]}
      stickySectionHeadersEnabled={false}
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
      ListEmptyComponent={<Empty title="No reservations yet" body="Book a table from any venue page and it will show up here." />}
      renderSectionHeader={({ section }) => <Text style={s.label}>{section.title}</Text>}
      renderItem={({ item: r }) => {
        const canCancel = isUpcoming(r) && new Date(r.starts_at).getTime() > now;
        return (
          <View style={[s.card, { padding: 14 }]}>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <Text style={[s.h2, { flex: 1, paddingRight: 8 }]} numberOfLines={1}>
                {r.venue?.name ?? 'Venue'}
              </Text>
              <StatusBadge status={r.status} label={STATUS_LABEL[r.status]} />
            </View>
            <Text style={[s.body, { marginTop: 4 }]}>
              {r.table?.name ?? 'Table'}
              {r.table?.location ? ` · ${r.table.location}` : ''}
            </Text>
            <Text style={[s.muted, { marginTop: 4 }]}>
              {dateTimeLabel(r.starts_at)} · {r.party_size} guests
            </Text>
            {r.business_note ? <Text style={[s.body, { marginTop: 8 }]}>From the venue: {r.business_note}</Text> : null}
            {canCancel && (
              <Button
                title="Cancel reservation"
                variant="secondary"
                onPress={() => cancel(r)}
                loading={cancelling === r.id}
                style={{ marginTop: 12, height: 42 }}
              />
            )}
          </View>
        );
      }}
    />
  );
}
