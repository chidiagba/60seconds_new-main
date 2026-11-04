import { SLOT_CONFIG } from './types';

/** Midnight (local) of each bookable day, starting today. */
export function buildBookableDays(now = new Date(), daysAhead: number = SLOT_CONFIG.daysAhead): Date[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Array.from({ length: daysAhead }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/**
 * Start times for the night that begins on `day`. Hours past 24 roll into the
 * next morning, so a night out stays on the date guests think of it as.
 * Slots in the past (or starting within `leadMinutes`) are dropped.
 */
export function buildSlotsForNight(day: Date, now = new Date(), leadMinutes = 30): Date[] {
  const { firstSlot, lastSlotHour, intervalMinutes } = SLOT_CONFIG;
  const slots: Date[] = [];
  const first = firstSlot.hour * 60 + firstSlot.minute;
  const last = lastSlotHour * 60;
  const earliest = now.getTime() + leadMinutes * 60_000;
  for (let m = first; m <= last; m += intervalMinutes) {
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m);
    if (d.getTime() >= earliest) slots.push(d);
  }
  return slots;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Tonight", "Tomorrow" or "Fri 2 Oct" */
export function dayLabel(day: Date, now = new Date()): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (sameDay(day, today)) return 'Today';
  if (sameDay(day, tomorrow)) return 'Tomorrow';
  return day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function timeLabel(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function dateTimeLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${timeLabel(d)}`;
}

export function money(amount: number | null, currency: string): string | null {
  if (amount == null) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Match the same complete-booking window enforced by reserve_venue_order. */
export function withinBookingWindow(table: { available_from?: string | null; available_until?: string | null; booking_duration_minutes: number }, start: Date): boolean {
  return (!table.available_from || start.getTime() >= Date.parse(table.available_from)) &&
    (!table.available_until || start.getTime() + table.booking_duration_minutes * 60000 <= Date.parse(table.available_until));
}
