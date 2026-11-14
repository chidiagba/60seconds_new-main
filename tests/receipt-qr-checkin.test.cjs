const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('paid order details show unique ticket and table reservation QRs with venue and check-in status', () => {
  const source = fs.readFileSync('app/order/[id].tsx', 'utf8');
  assert.match(source, /from\('ticket_receipts'\)/);
  assert.match(source, /from\('event_table_bookings'\)/);
  assert.match(source, /QRCode value=\{receipt\.qr_code_data\}/);
  assert.match(source, /QRCode value=\{booking\.qr_code\}/);
  assert.match(source, /booking\.event\?\.location_name/);
  assert.match(source, /booking\.checked_in_at\?'Already checked in'/);
  assert.match(source, /order\.payment_status==='paid'/);
});

test('the scanner dispatches table reservation QR codes to authenticated one-time check-in', () => {
  const database = fs.readFileSync('lib/database.ts', 'utf8');
  const scanner = fs.readFileSync('app/scan-qr.tsx', 'utf8');
  assert.match(database, /startsWith\('TABLE:'\)/);
  assert.match(database, /redeem_event_table_booking/);
  assert.match(database, /redeem_ticket/);
  assert.match(scanner, /Reservation Checked In/);
});

test('reservation check-in is paid, organizer-owned, row-locked, and cannot reuse a QR', () => {
  const sql = fs.readFileSync('supabase/migrations/20261113100000_secure_event_table_checkin.sql', 'utf8');
  assert.match(sql, /create unique index if not exists event_table_bookings_qr_code_unique/);
  assert.match(sql, /for update/);
  assert.match(sql, /booking\.state <> 'confirmed'/);
  assert.match(sql, /purchase\.payment_status <> 'paid'/);
  assert.match(sql, /is distinct from actor_id/);
  assert.match(sql, /checked_in_at is not null/);
  assert.match(sql, /grant execute on function public\.redeem_event_table_booking\(text\) to authenticated/);
});
