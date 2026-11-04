import { useAuth } from '@/lib/auth';
import { resolveCurrencyFromCountry } from '@/utils/country-currency';
// Business: create or edit a table — name, location, description, capacity,
// pricing, booking rules and photos.
import React from 'react';
import { FloorPlan } from '../FloorPlan';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { NativeStackScreenProps } from '../router';
import {
  listVenueTables,
  createVenueTable,
  deleteTableImage,
  deleteVenueTable,
  errorMessage,
  getVenueTable,
  reorderTableImages,
  updateVenueTable,
  uploadTableImage,
} from '../api';
import type { TablesStackParamList } from '../navigation';
import type { TableImage, VenueTable, VenueTableInput } from '../types';
import { Button, Chip, Loading, Stepper, colors, s } from '../ui';

type Props = NativeStackScreenProps<TablesStackParamList, 'TableEditor'>;

const MAX_PHOTOS = 8;
const DURATIONS = [120, 180, 240, 300, 360];

/** A photo already saved, or one picked locally and not yet uploaded. */
type Photo = { kind: 'saved'; image: TableImage } | { kind: 'local'; uri: string; key: string };

export default function TableEditorScreen({ route, navigation }: Props) {
  const { venueId, tableId } = route.params;
  const { profile } = useAuth();
  const [table, setTable] = React.useState<VenueTable | null>(null);
  const [loading, setLoading] = React.useState(!!tableId);
  const [saving, setSaving] = React.useState(false);

  const [mapX, setMapX] = React.useState(50);
  const [mapY, setMapY] = React.useState(50);
  const [mapColor, setMapColor] = React.useState('#ff963f');
  const [others, setOthers] = React.useState<VenueTable[]>([]);
  React.useEffect(() => { listVenueTables(venueId).then(setOthers).catch(() => undefined); }, [venueId]);
  const [availableFrom, setAvailableFrom] = React.useState('');
  const [availableUntil, setAvailableUntil] = React.useState('');
  const [name, setName] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [minGuests, setMinGuests] = React.useState(2);
  const [maxGuests, setMaxGuests] = React.useState(6);
  const [minSpend, setMinSpend] = React.useState('');
  const [deposit, setDeposit] = React.useState('');
  const [currency, setCurrency] = React.useState(() => resolveCurrencyFromCountry({countryCode: profile?.country_code, country: profile?.country, fallbackCurrency:'EUR'}));
  const [duration, setDuration] = React.useState(180);
  const [isActive, setIsActive] = React.useState(true);
  const [photos, setPhotos] = React.useState<Photo[]>([]);

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: tableId ? 'Edit table' : 'New table' });
  }, [navigation, tableId]);

  React.useEffect(() => {
    if (!tableId) return;
    getVenueTable(tableId)
      .then((t) => {
        setTable(t);
        setMapX(t.map_x); setMapY(t.map_y); setMapColor(t.map_color);
        setName(t.name);
        setAvailableFrom(t.available_from || '');
        setAvailableUntil(t.available_until || '');
        setLocation(t.location ?? '');
        setDescription(t.description ?? '');
        setMinGuests(t.min_guests);
        setMaxGuests(t.max_guests);
        setMinSpend(t.minimum_spend != null ? String(t.minimum_spend) : '');
        setDeposit(t.deposit_amount != null ? String(t.deposit_amount) : '');
        setCurrency(t.currency);
        setDuration(t.booking_duration_minutes);
        setIsActive(t.is_active);
        setPhotos(t.images.map((image) => ({ kind: 'saved', image })));
      })
      .catch((e) => {
        Alert.alert('Could not load table', errorMessage(e));
        navigation.goBack();
      })
      .finally(() => setLoading(false));
  }, [tableId, navigation]);

  async function pickPhotos() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photos access needed', 'Allow photo access in Settings to add table photos.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS - photos.length,
      quality: 1,
    });
    if (res.canceled) return;
    setPhotos((p) =>
      [...p, ...res.assets.map((a, i) => ({ kind: 'local' as const, uri: a.uri, key: `${Date.now()}-${i}` }))].slice(
        0,
        MAX_PHOTOS,
      ),
    );
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera access needed', 'Allow camera access in Settings to photograph your tables.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (res.canceled) return;
    setPhotos((p) => [...p, { kind: 'local' as const, uri: res.assets[0].uri, key: `${Date.now()}` }].slice(0, MAX_PHOTOS));
  }

  function photoActions(photo: Photo, index: number) {
    const buttons: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [];
    if (index > 0) buttons.push({ text: 'Make cover photo', onPress: () => makeCover(index) });
    buttons.push({ text: 'Remove', style: 'destructive', onPress: () => removePhoto(photo, index) });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Photo', undefined, buttons);
  }

  async function makeCover(index: number) {
    const next = [photos[index], ...photos.filter((_, i) => i !== index)];
    setPhotos(next);
    const saved = next.filter((p): p is Extract<Photo, { kind: 'saved' }> => p.kind === 'saved').map((p) => p.image);
    if (saved.length) {
      try {
        await reorderTableImages(saved);
      } catch (e) {
        Alert.alert('Could not reorder photos', errorMessage(e));
      }
    }
  }

  async function removePhoto(photo: Photo, index: number) {
    if (photo.kind === 'saved') {
      try {
        await deleteTableImage(photo.image);
      } catch (e) {
        Alert.alert('Could not remove photo', errorMessage(e));
        return;
      }
    }
    setPhotos((p) => p.filter((_, i) => i !== index));
  }

  function parseAmount(v: string): number | null {
    const n = Number(v.replace(',', '.').trim());
    return v.trim() === '' || Number.isNaN(n) ? null : Math.max(0, n);
  }

  async function save() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give the table a name guests will recognise, e.g. "VIP 1" or "Booth 4".');
      return;
    }
    if ([availableFrom, availableUntil].some(v => v.trim() && !Number.isFinite(Date.parse(v))) || (availableFrom && availableUntil && Date.parse(availableUntil) <= Date.parse(availableFrom))) {
      Alert.alert('Invalid dates', 'Use a date and time such as 2026-12-01T18:00. End must be after start.'); return;
    }
    if (!(Number(deposit || minSpend) > 0) || !Number.isFinite(Number(deposit || minSpend))) { Alert.alert('Booking price required', 'Set a positive deposit or minimum spend for checkout.'); return; }
    const input: VenueTableInput = {
      available_from: availableFrom.trim() ? new Date(availableFrom).toISOString() : null,
      available_until: availableUntil.trim() ? new Date(availableUntil).toISOString() : null,
      map_x: mapX, map_y: mapY, map_color: mapColor,
      name: name.trim(),
      location: location.trim() || null,
      description: description.trim() || null,
      min_guests: minGuests,
      max_guests: maxGuests,
      minimum_spend: parseAmount(minSpend),
      deposit_amount: parseAmount(deposit),
      currency: currency.trim().toUpperCase().slice(0, 3) || 'EUR',
      booking_duration_minutes: duration,
      requires_approval: false,
      is_active: isActive,
    };

    setSaving(true);
    try {
      const saved = table ? await updateVenueTable(table.id, input) : await createVenueTable(venueId, input);

      setTable(saved);
      setOthers(previous => previous.filter(t => t.id !== saved.id));
      // Upload new photos in the order shown, then persist the final order.
      const finalImages: TableImage[] = [];
      for (const [i, p] of photos.entries()) {
        const image = p.kind === 'saved' ? p.image : await uploadTableImage(saved, p.uri, i);
        finalImages.push(image);
        if (p.kind === 'local') setPhotos(current => current.map(photo => photo.kind === 'local' && photo.key === p.key ? { kind: 'saved', image } : photo));
      }
      if (finalImages.length) await reorderTableImages(finalImages);

      navigation.goBack();
    } catch (e) {
      Alert.alert('Could not save table', errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!table) return;
    Alert.alert(
      `Delete ${table.name}?`,
      'This also deletes its photos and all of its bookings. To stop new bookings but keep history, switch it to hidden instead.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteVenueTable(table);
              navigation.goBack();
            } catch (e) {
              Alert.alert('Could not delete table', errorMessage(e));
            }
          },
        },
      ],
    );
  }

  if (loading) return <Loading />;

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.pad, { paddingBottom: 40 }]} keyboardShouldPersistTaps="handled">
        <Text style={[s.label, { marginTop: 0 }]}>Photos ({photos.length}/{MAX_PHOTOS})</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {photos.map((p, i) => (
            <Pressable key={p.kind === 'saved' ? p.image.id : p.key} onPress={() => photoActions(p, i)} style={{ marginRight: 10 }}>
              <Image
                source={{ uri: p.kind === 'saved' ? p.image.url : p.uri }}
                style={{ width: 110, height: 110, borderRadius: 10, backgroundColor: colors.card }}
              />
              {i === 0 && (
                <View style={{ position: 'absolute', left: 6, top: 6, backgroundColor: colors.accent, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Text style={{ color: colors.accentText, fontSize: 11, fontWeight: '700' }}>Cover</Text>
                </View>
              )}
              {p.kind === 'local' && (
                <Text style={[s.muted, { fontSize: 11, marginTop: 4 }]}>Uploads on save</Text>
              )}
            </Pressable>
          ))}
          {photos.length < MAX_PHOTOS && (
            <View>
              <Pressable onPress={pickPhotos} style={[s.placeholder, { width: 110, height: 50, borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: colors.border }]}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>+ Library</Text>
              </Pressable>
              <Pressable onPress={takePhoto} style={[s.placeholder, { width: 110, height: 50, borderRadius: 10, borderWidth: 1, borderColor: colors.border }]}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>+ Camera</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
        <Text style={[s.muted, { marginTop: 8, fontSize: 12 }]}>Tap a photo to make it the cover or remove it.</Text>

        <Text style={s.label}>Table name</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="VIP 1" placeholderTextColor={colors.muted} maxLength={80} />

        <Text style={s.label}>Position on the floor plan</Text>
        <Text style={s.muted}>Tap the plan to place this table. Other tables show their saved positions.</Text>
        <FloorPlan tables={[...others.filter(t => t.id !== tableId), { id: 'editing', name: name || 'New', map_x: mapX, map_y: mapY, map_color: mapColor, minimum_spend: parseAmount(minSpend), currency, max_guests: maxGuests }]} selected="editing" onPlace={(x, y) => { setMapX(x); setMapY(y); }} />
        <View style={s.row}>{['#ff963f', '#28c5f6', '#ee62d2'].map((c, i) => <Chip key={c} label={['Orange', 'Blue', 'Pink'][i]} selected={mapColor === c} onPress={() => setMapColor(c)} />)}</View>
        <Text style={s.label}>Location in the venue</Text>
        <TextInput style={s.input} value={location} onChangeText={setLocation} placeholder="Balcony, next to the DJ booth" placeholderTextColor={colors.muted} maxLength={120} />

        <Text style={s.label}>Description</Text>
        <TextInput
          style={[s.input, { minHeight: 90, textAlignVertical: 'top' }]}
          value={description}
          onChangeText={setDescription}
          placeholder="Private booth with sofa seating, dedicated host, view of the main floor…"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={1000}
        />

        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <View>
            <Text style={s.label}>Min guests</Text>
            <Stepper value={minGuests} min={1} max={maxGuests} onChange={setMinGuests} />
          </View>
          <View>
            <Text style={s.label}>Max guests</Text>
            <Stepper value={maxGuests} min={minGuests} max={40} onChange={setMaxGuests} />
          </View>
        </View>

        <View style={[s.row, { gap: 10 }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Minimum spend</Text>
            <TextInput style={s.input} value={minSpend} onChangeText={setMinSpend} keyboardType="decimal-pad" placeholder="Optional" placeholderTextColor={colors.muted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Deposit</Text>
            <TextInput style={s.input} value={deposit} onChangeText={setDeposit} keyboardType="decimal-pad" placeholder="Optional" placeholderTextColor={colors.muted} />
          </View>
          <View style={{ width: 80 }}>
            <Text style={s.label}>Currency</Text>
            <TextInput style={s.input} value={currency} onChangeText={setCurrency} autoCapitalize="characters" maxLength={3} />
          </View>
        </View>

        <Text style={s.label}>Each booking lasts</Text>
        <View style={[s.row, { flexWrap: 'wrap' }]}>
          {DURATIONS.map((m) => (
            <Chip key={m} label={`${m / 60} h`} selected={duration === m} onPress={() => setDuration(m)} />
          ))}
        </View>

        <Text style={s.label}>Booking dates (optional)</Text>
        <Text style={s.muted}>Enter local date and time as YYYY-MM-DDTHH:mm. Guests can book only within this window. Payment confirms the reservation automatically.</Text>
        <Text style={s.label}>Available from</Text>
        <TextInput accessibilityLabel="Available from" style={s.input} value={availableFrom} onChangeText={setAvailableFrom} placeholder="YYYY-MM-DDTHH:mm" placeholderTextColor={colors.muted} />
        <Text style={s.label}>Available until</Text>
        <TextInput accessibilityLabel="Available until" style={s.input} value={availableUntil} onChangeText={setAvailableUntil} placeholder="YYYY-MM-DDTHH:mm" placeholderTextColor={colors.muted} />
        <Text style={s.muted}>The deposit is charged at checkout, or the minimum spend when no deposit is set. A 4% platform fee is added.</Text>

        <View style={[s.row, { justifyContent: 'space-between', marginTop: 16 }]}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.body}>Bookable</Text>
            <Text style={s.muted}>{isActive ? 'Guests can see and book this table' : 'Hidden from guests'}</Text>
          </View>
          <Switch value={isActive} onValueChange={setIsActive} trackColor={{ true: colors.accent, false: colors.border }} />
        </View>

        <Button title={table ? 'Save changes' : 'Create table'} onPress={save} loading={saving} style={{ marginTop: 28 }} />
        {table && <Button title="Delete table" variant="danger" onPress={confirmDelete} style={{ marginTop: 12 }} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
