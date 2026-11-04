// Data layer for table reservations. All calls go through the app's existing
// Supabase client; permissions are enforced by RLS and the RPCs in the migration.
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import type {
  BusyRange,
  ReservationStatus,
  ReservationWithTable,
  TableImage,
  TableReservation,
  VenueTable,
  VenueTableInput,
} from './types';

const BUCKET = 'table-images';

type RawTable = Omit<VenueTable, 'images'> & {
  images: Omit<TableImage, 'url'>[] | null;
};

function withUrls(t: RawTable): VenueTable {
  const images = (t.images ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((img) => ({
      ...img,
      url: supabase.storage.from(BUCKET).getPublicUrl(img.storage_path).data.publicUrl,
    }));
  return { ...t, images };
}

/** Turns Postgres/RPC errors into a message you can show a user. */
export function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'Something went wrong. Please try again.';
}

// ---------------------------------------------------------------------------
// Tables (business + guest)
// ---------------------------------------------------------------------------

const TABLE_SELECT = '*, images:venue_table_images(id, table_id, storage_path, position)';

/** Guests get active tables; a venue's manager also gets hidden ones (RLS decides). */
export async function listVenueTables(venueId: string): Promise<VenueTable[]> {
  const { data, error } = await supabase
    .from('venue_tables')
    .select(TABLE_SELECT)
    .eq('venue_id', venueId)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return (data as RawTable[]).map(withUrls);
}

export async function getVenueTable(tableId: string): Promise<VenueTable> {
  const { data, error } = await supabase
    .from('venue_tables')
    .select(TABLE_SELECT)
    .eq('id', tableId)
    .single();
  if (error) throw error;
  return withUrls(data as RawTable);
}

export async function createVenueTable(venueId: string, input: VenueTableInput): Promise<VenueTable> {
  const { data, error } = await supabase
    .from('venue_tables')
    .insert({ ...input, venue_id: venueId })
    .select(TABLE_SELECT)
    .single();
  if (error) throw error;
  return withUrls(data as RawTable);
}

export async function updateVenueTable(tableId: string, input: Partial<VenueTableInput>): Promise<VenueTable> {
  const { data, error } = await supabase
    .from('venue_tables')
    .update(input)
    .eq('id', tableId)
    .select(TABLE_SELECT)
    .single();
  if (error) throw error;
  return withUrls(data as RawTable);
}

export async function deleteVenueTable(table: VenueTable): Promise<void> {
  const { error } = await supabase.from('venue_tables').delete().eq('id', table.id);
  if (error) throw error;
  if (table.images.length) {
    await supabase.storage.from(BUCKET).remove(table.images.map((i) => i.storage_path));
  }
}

// ---------------------------------------------------------------------------
// Table photos
// ---------------------------------------------------------------------------

/**
 * Reads a local photo (from expo-image-picker), validates its size,
 * uploads it to "{venueId}/{tableId}/{random}.jpg" and records it.
 */
export async function uploadTableImage(
  table: Pick<VenueTable, 'id' | 'venue_id'>,
  localUri: string,
  position: number,
): Promise<TableImage> {
  const body = Platform.OS === 'web'
    ? await (await fetch(localUri)).arrayBuffer()
    : await new File(localUri).arrayBuffer();
  if (body.byteLength > 5 * 1024 * 1024) throw new Error('Choose a photo smaller than 5 MB.');
  const bytes = new Uint8Array(body);
  const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png'
    : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
    : bytes[0] === 0x52 && bytes[8] === 0x57 ? 'image/webp' : 'image/heic';
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${mime.split('/')[1]}`;
  const path = `${table.venue_id}/${table.id}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, { contentType: mime, upsert: false });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('venue_table_images')
    .insert({ table_id: table.id, storage_path: path, position })
    .select('id, table_id, storage_path, position')
    .single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw error;
  }
  return {
    ...(data as Omit<TableImage, 'url'>),
    url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
  };
}

export async function deleteTableImage(image: TableImage): Promise<void> {
  const { error } = await supabase.from('venue_table_images').delete().eq('id', image.id);
  if (error) throw error;
  await supabase.storage.from(BUCKET).remove([image.storage_path]);
}

/** Saves a new photo order (first photo is the cover). */
export async function reorderTableImages(images: TableImage[]): Promise<void> {
  const results = await Promise.all(
    images.map((img, position) =>
      supabase.from('venue_table_images').update({ position }).eq('id', img.id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

// ---------------------------------------------------------------------------
// Availability & booking (guest)
// ---------------------------------------------------------------------------

export async function getBusyRanges(venueId: string, from: Date, to: Date): Promise<BusyRange[]> {
  const { data, error } = await supabase.rpc('get_table_availability', {
    p_venue_id: venueId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) throw error;
  return (data ?? []) as BusyRange[];
}

/** True when a booking of `durationMinutes` starting at `start` overlaps a busy range. */
export function isSlotTaken(
  tableId: string,
  start: Date,
  durationMinutes: number,
  busy: BusyRange[],
): boolean {
  const s = start.getTime();
  const e = s + durationMinutes * 60_000;
  return busy.some(
    (b) =>
      b.table_id === tableId &&
      new Date(b.starts_at).getTime() < e &&
      new Date(b.ends_at).getTime() > s,
  );
}

export async function reserveTable(params: {
  tableId: string; startsAt: Date; partySize: number; name: string; email: string; note?: string;
}): Promise<string> {
  const { data, error } = await supabase.functions.invoke('guest-event', { body: {
    action: 'venue-checkout', ...params, startsAt: params.startsAt.toISOString(),
  }});
  if (error || data?.error) {
    let message = data?.error;
    try { message ||= (await (error as any)?.context?.json())?.error; } catch {}
    throw new Error(message || 'Could not start payment. Please try again.');
  }
  if (!/^https:\/\/checkout\.(stripe|paystack)\.com\//.test(data?.url || '')) throw new Error('Payment unavailable');
  return data.url;
}

const RESERVATION_SELECT =
  '*, table:venue_tables(id, name, location), venue:profiles!table_reservations_venue_id_fkey(id, name:business_name)';

export async function listMyReservations(): Promise<ReservationWithTable[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await supabase
    .from('table_reservations')
    .select(RESERVATION_SELECT)
    .eq('guest_id', auth.user.id)
    .order('starts_at', { ascending: false });
  if (error) throw error;
  return data as ReservationWithTable[];
}

// ---------------------------------------------------------------------------
// Reservation inbox (business)
// ---------------------------------------------------------------------------

export async function listVenueReservations(
  venueId: string,
  from: Date,
  to: Date,
): Promise<ReservationWithTable[]> {
  const { data, error } = await supabase
    .from('table_reservations')
    .select(RESERVATION_SELECT)
    .eq('venue_id', venueId)
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString())
    .order('starts_at');
  if (error) throw error;
  return data as ReservationWithTable[];
}

/** Guests may only pass 'cancelled'; the database enforces the allowed transitions. */
export async function setReservationStatus(
  reservationId: string,
  status: ReservationStatus,
  businessNote?: string,
): Promise<TableReservation> {
  const { data, error } = await supabase.rpc('update_table_reservation_status', {
    p_reservation_id: reservationId,
    p_status: status,
    p_business_note: businessNote ?? null,
  });
  if (error) throw error;
  return data as TableReservation;
}

/** Live updates for the business inbox. Returns an unsubscribe function. */
export function subscribeToVenueReservations(venueId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`table_reservations:${venueId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'table_reservations', filter: `venue_id=eq.${venueId}` },
      onChange,
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
