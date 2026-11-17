# Discover → Deals

The second bottom tab's Deals category now shows public, open/published events
whose booking window has not ended and which have at least one available paid
ticket/product or bookable event table. An event need not offer all three types.

The old ambiguous `events`/`videos` relationship embed is removed from Deals.
Other event queries and the guest event page explicitly use
`events_video_id_fkey`. A new read-only, service-role RPC
`public_deals_events` counts active, in-stock, positive-price products and tables
with remaining capacity. Held and confirmed bookings consume capacity; released
bookings do not. Exclusive whole tables require all seats to be available.
Only public event details, public creator identity and video preview fields are
returned; booking/customer records are not returned. No order, receipt, payment
or inventory rows are mutated by discovery.

Deals pages load 60 events at a time as the user scrolls, with stable ordering,
refresh and retry controls. Request generation checks prevent a stale response
from replacing a newly selected category. Events without videos still open their
public booking page. Each card has a Share button using the same helper as home
Share Page, and the same HTTPS event URL builder. Native Android/iOS share sheets
receive the event title, uploader, venue, date, description and event link.
The existing shared page supports ticket/product/table checkout.

## Deployment and verification

- Applied `20261116150000_public_deals_discovery.sql` to the linked 60Seconds
  Supabase project after a successful live-schema rollback rehearsal.
- Deployed `guest-event` version **23**, ACTIVE, including the validated Deals action and explicit
  event/video relationship used by public pages.
- Live read-only check: HTTP 200, two eligible events, no further page; both
  corresponding public event pages returned HTTP 200. Invalid page size returned
  HTTP 400. No checkout was initiated.
- Synthetic PostgreSQL tests passed: product-only/table-only eligibility,
  inactive/zero-price/sold-out offers, ended/private/draft events, held/confirmed/
  released seats, exclusive tables, pagination and service-role-only RPC access.
- Node suite: 208 passed, zero failures/skips. TypeScript, lint and source secret scan passed.
- Expo release exports succeeded for both Android (3,726 modules) and iOS
  (3,720 modules), producing Hermes bundles. This verifies bundle compilation,
  not native installation or hardware behavior.

Evidence: `build/deals-verification/`. Changes apply to the shared Discover screen
used by Android and iOS. No physical device is connected; hardware interaction,
installation and store distribution are not claimed.
