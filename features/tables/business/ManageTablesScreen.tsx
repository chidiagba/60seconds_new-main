// Business: list of the venue's tables, with add / edit / show-hide.
import React from 'react';
import { Alert, FlatList, Image, Pressable, RefreshControl, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '../router';
import { errorMessage, listVenueTables, updateVenueTable } from '../api';
import { money } from '../format';
import type { TablesStackParamList } from '../navigation';
import type { VenueTable } from '../types';
import { Button, Empty, Loading, colors, s } from '../ui';

type Props = NativeStackScreenProps<TablesStackParamList, 'ManageTables'>;

export default function ManageTablesScreen({ route, navigation }: Props) {
  const { venueId } = route.params;
  const [tables, setTables] = React.useState<VenueTable[] | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setTables(await listVenueTables(venueId));
    } catch (e) {
      Alert.alert('Could not load tables', errorMessage(e));
      setTables((t) => t ?? []);
    }
  }, [venueId]);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load]),
  );

  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Your tables',
      headerRight: () => (
        <Pressable onPress={() => navigation.navigate('VenueReservations', { venueId })} hitSlop={10}>
          <Text style={{ color: colors.accent, fontWeight: '700' }}>Bookings</Text>
        </Pressable>
      ),
    });
  }, [navigation, venueId]);

  async function toggleActive(t: VenueTable, is_active: boolean) {
    setTables((list) => list?.map((x) => (x.id === t.id ? { ...x, is_active } : x)) ?? null);
    try {
      await updateVenueTable(t.id, { is_active });
    } catch (e) {
      setTables((list) => list?.map((x) => (x.id === t.id ? { ...x, is_active: !is_active } : x)) ?? null);
      Alert.alert('Could not update table', errorMessage(e));
    }
  }

  if (!tables) return <Loading />;

  return (
    <View style={s.screen}>
      <FlatList
        data={tables}
        keyExtractor={(t) => t.id}
        contentContainerStyle={[s.pad, !tables.length && { flex: 1 }]}
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
        ListEmptyComponent={
          <Empty
            title="No tables yet"
            body="Add your tables with photos so guests can book them from your venue page."
          />
        }
        renderItem={({ item: t }) => (
          <Pressable
            style={s.card}
            onPress={() => navigation.navigate('TableEditor', { venueId, tableId: t.id })}
          >
            <View style={s.row}>
              {t.images[0] ? (
                <Image source={{ uri: t.images[0].url }} style={{ width: 96, height: 96 }} />
              ) : (
                <View style={[s.placeholder, { width: 96, height: 96 }]}>
                  <Text style={[s.muted, { fontSize: 12 }]}>No photo</Text>
                </View>
              )}
              <View style={{ flex: 1, padding: 12 }}>
                <Text style={s.h2} numberOfLines={1}>{t.name}</Text>
                {t.location ? <Text style={s.muted} numberOfLines={1}>{t.location}</Text> : null}
                <Text style={[s.muted, { marginTop: 4 }]}>
                  {t.min_guests}–{t.max_guests} guests
                  {t.minimum_spend != null ? ` · min ${money(t.minimum_spend, t.currency)}` : ''}
                </Text>
              </View>
              <View style={{ paddingRight: 12, alignItems: 'center' }}>
                <Switch
                  value={t.is_active}
                  onValueChange={(v) => toggleActive(t, v)}
                  trackColor={{ true: colors.accent, false: colors.border }}
                />
                <Text style={[s.muted, { fontSize: 11, marginTop: 2 }]}>{t.is_active ? 'Bookable' : 'Hidden'}</Text>
              </View>
            </View>
          </Pressable>
        )}
      />
      <View style={s.footer}>
        <Button title="Add a table" onPress={() => navigation.navigate('TableEditor', { venueId })} />
      </View>
    </View>
  );
}
