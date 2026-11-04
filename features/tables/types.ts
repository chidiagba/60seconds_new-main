// Shared types for the table reservation feature.
// Mirrors supabase/migrations/20260929000000_table_reservations.sql

export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'declined'
  | 'cancelled'
  | 'completed'
  | 'no_show';

export interface TableImage {
  id: string;
  table_id: string;
  storage_path: string;
  position: number;
  /** Public URL, added client-side */
  url: string;
}

export interface VenueTable {
  id: string;
  venue_id: string;
  name: string;
  location: string | null;
  description: string | null;
  min_guests: number;
  max_guests: number;
  minimum_spend: number | null;
  deposit_amount: number | null;
  currency: string;
  booking_duration_minutes: number;
  requires_approval: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  images: TableImage[];
  available_from: string | null;
  available_until: string | null;
  map_x: number;
  map_y: number;
  map_color: string;
}

/** Fields a business can edit on a table. */
export type VenueTableInput = Pick<
  VenueTable,
  | 'available_from'
  | 'available_until'
  | 'map_x'
  | 'map_y'
  | 'map_color'
  | 'name'
  | 'location'
  | 'description'
  | 'min_guests'
  | 'max_guests'
  | 'minimum_spend'
  | 'deposit_amount'
  | 'currency'
  | 'booking_duration_minutes'
  | 'requires_approval'
  | 'is_active'
>;

export interface TableReservation {
  id: string;
  table_id: string;
  venue_id: string;
  guest_id: string;
  order_id?: string | null;
  guest_name?: string | null;
  guest_email?: string | null;
  party_size: number;
  starts_at: string;
  ends_at: string;
  status: ReservationStatus;
  guest_note: string | null;
  business_note: string | null;
  created_at: string;
  updated_at: string;
}

/** Reservation joined with its table (and venue name for the guest's list). */
export interface ReservationWithTable extends TableReservation {
  table: Pick<VenueTable, 'id' | 'name' | 'location'> | null;
  venue: { id: string; name: string } | null;
}

export interface BusyRange {
  table_id: string;
  starts_at: string;
  ends_at: string;
}

/** Start times offered to guests. Adjust to your venues' opening hours. */
export const SLOT_CONFIG = {
  /** Days ahead a guest can book */
  daysAhead: 21,
  /** First start time of the night, local time (hour, minute) */
  firstSlot: { hour: 0, minute: 0 },
  /** Last start time; values past 24 wrap into the next morning (26 = 02:00) */
  lastSlotHour: 23.5,
  intervalMinutes: 30,
} as const;

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  declined: 'Declined',
  cancelled: 'Cancelled',
  completed: 'Completed',
  no_show: 'No-show',
};
