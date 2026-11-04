# Table reservations

> Profile bookings are restored with verified payment checkout in [the November table-booking update](2026-11-03-table-bookings.md). The venue-level unpaid flow below describes the historical implementation.

Adapted the supplied table-reservations package to Expo Router and the app's `profiles` business identities. No new dependencies. Existing unrelated workspace changes are preserved.

## Setup

Apply `supabase/migrations/20261005100000_table_reservations.sql` to the intended Supabase project using your normal migration process. Applied to the linked Supabase project `rvvujgbaswecqohixgog` on 2026-10-05. Only this migration was deployed; seven unrelated pending migrations were excluded. The deployed table-map REST endpoint returned HTTP 200. The migration creates tables, RPCs, RLS policies, the `table-images` storage bucket, and realtime subscription support.

Business profile → **Manage tables & reservations** → **Add a table**. Configure capacity, minimum spend, deposit, photos, booking duration, approval mode and visibility. Tap the floor plan to position each table and choose its colour. Use **Bookings** to confirm, decline, cancel, mark arrived or no-show.

Public business profile → **Reserve a table**. Pick a night and arrival time, tap a table, and continue to the booking form. Grey tables are unavailable for that table's booking duration. The database rejects overlapping pending/confirmed reservations even if availability changes after viewing the map. Signed-in guests see and cancel their upcoming bookings under **My table reservations** on their profile.

## Current boundaries

The map is a responsive schematic inspired by the reference, with fixed bar, DJ, dance-floor and entrance landmarks; table coordinates, colours, names, prices and capacities are configured per business. It does not import a venue background image or create the reference's sample tables/prices automatically.

Times use the device's time zone, as explicitly stated in the UI; no venue-time-zone or custom-opening-hours configuration is included. Default arrivals are 18:00–02:00 over 21 nights. Deposits are displayed and settled with the venue, not charged in-app. Booking status is available in My reservations; push notifications are not included. Table photos are limited to 5 MB each.

## Validation

The migration and `tests/table-reservations.sql` pass on a temporary local PostgreSQL database with minimal Supabase auth/storage fixtures. Tests cover business-only table creation, past-time and party-size validation, instant/approval reservations, overlapping booking rejection, guest privacy, availability, cancellation and rebooking.

Full-project `tsc --noEmit` currently reports pre-existing errors elsewhere in the app; no errors are reported in `features/tables` or `app/tables`. Android debug build installed and launched successfully on the connected Samsung SM_A075F on 2026-10-05. The My reservations route rendered its sign-in prompt; authenticated booking interaction still needs a signed-in account. No ReactNativeJS or AndroidRuntime startup errors were reported during the smoke check.

## Feed and navigation fix — 2026-10-06

Applied `20261004100000_random_video_feed.sql` to the linked project after confirming an isolated deployment contained only that migration. The public RPC returned HTTP 200 and video rows. The app also falls back to chronologically paginated videos for the session when an older server returns PGRST202; other errors remain visible. Four loader regression tests pass (`node --test tests/video-feed.test.cjs`).

Shared profile and Settings controls now expose My table reservations and, for business accounts, Table settings & floor plan, Table booking requests, and Preview guest table reservations. Profile controls appear above the profile details. Table route headers are configured for sign-in/error states as well as loaded screens.

Android rebuild/install succeeded on Samsung SM_A075F. iOS production JavaScript/Hermes export succeeded. The paired iPhone 15 Pro was reported unavailable by devicectl, so a physical iOS launch was not possible. Full-project TypeScript still reports existing errors, with none in the new loader, shared table components, Settings changes or profile navigation changes.

Android smoke check: runtime logged `VideoStore: Fetched 20 videos from database`; the rendered feed displayed video details. Settings visibly showed all four table links for the signed-in business account, with no ReactNativeJS/AndroidRuntime errors in the checked logs. No test bookings or sample tables were created in production.
