# Profile and event table bookings

Business profiles expose **Book a table**. Business owners use **Tables & reservations → Manage tables & availability** to create and edit table names, capacity, photos, visibility, booking duration, price/deposit and optional availability start/end dates. Guests select a date, arrival time, table and party size, enter their name/email and continue to Stripe payment. Nearby date shortcuts and a YYYY-MM-DD field support dates beyond the shortcuts. Times use the device time zone; explicit ISO offsets in business availability fields are respected.

The positive deposit is charged once for the whole table; when no deposit is configured, the minimum spend is charged. Prices include the existing 4% platform fee. NGN bookings use Paystack, including existing subaccount routing or platform collection with the canonical owner ledger. Other currencies use Stripe and require an enabled connected account. The live project currently has no Stripe-connected business profiles; those sellers must finish onboarding before Stripe checkout is available. A checkout holds the entire venue table for its booking duration. The database enforces availability windows, guest capacity and non-overlapping reservations. Only the verified payment fulfillment path confirms a hold. Paystack amounts, currency, reference and order metadata are rechecked against the provider API; a browser redirect does not confirm payment. Late Paystack payments for released holds are refunded instead of allocating an already released table. Refund retries and email delivery use the existing reconciliation worker. Expired/failed checkout releases it through the existing webhook/reconciliation lifecycle. Email receipts include the guest name, table, arrival and party size. Paid profile bookings and paid event reservations appear in My reservations; business owners see guest details in their reservation inbox.

Event table management now defaults to **whole table** with a business-defined guest capacity and price per table. Individual-seat inventory remains supported. Existing tables retain their per-seat behavior. Whole-table checkout holds every seat and charges the table price once. Booking mode cannot change while seats are held or paid.

Paid bookings cannot be manually cancelled or declined through the legacy status API; refunds require the existing support/payment process. Tables with checkout history must be hidden rather than deleted. The legacy unpaid booking RPC remains disabled.

The public event page now includes a Close event button, including its loading/error states, with a home fallback for direct links. Avatar synchronization responds to the first change, handles synchronous callbacks, and profile/feed avatars fall back to a bundled image if the remote image fails.

## Deployment

Deployed to Supabase project `rvvujgbaswecqohixgog` on 3 November 2026. Applied and recorded only the booking migrations listed below; unrelated pending migrations were excluded:

- `supabase/migrations/20261103100000_paid_venue_reservations.sql`
- `supabase/migrations/20261103110000_exclusive_event_tables.sql`
- `supabase/migrations/20261103120000_guest_paystack_tables.sql`
- `supabase/migrations/20261103130000_paystack_guest_ledger.sql`

Deployed `guest-event`, `guest-checkout-webhook`, `guest-checkout-reconcile` and `paystack-webhook-settlement` together: both payment workers include the changed shared fulfillment module. Keep the existing Stripe webhook signature verification, connected accounts, email provider and reconciliation schedule configured. Publish the web export and distribute rebuilt native apps. Do not push unrelated pending workspace migrations.

## Validation

Run `node --test tests/booking-availability.test.cjs tests/guest-paystack-booking.test.cjs tests/commerce-rules.test.cjs tests/profile-event-sharing.test.cjs tests/guest-email.test.cjs tests/event-links.test.cjs`.

In an EMPTY disposable PostgreSQL database, run `tests/paid-venue-fixture.sql`, followed by `tests/paid-venue-reservations.sql`. The fixture creates stand-in auth/storage/commerce tables; never apply it to a real project. Regression checks cover pricing, unpaid holds, date windows, capacity, overlapping reservations, forbidden manual confirmation, payment-session mismatch, idempotent fulfillment, hold release, exclusive tables and client permissions. The existing paid-event regression also passes against this fixture when its profile insert names the `id,user_type` columns.

A production Expo web export passes. Project-wide TypeScript checking still reports unrelated existing errors; no diagnostics occur in the new avatar component, booking components, changed shared event page or avatar-sync hook. No Stripe charge, delivered confirmation email or physical-device booking acceptance test was performed.

## Deployment and device verification

- The five retired profile-table route stubs are restored to their guest/business screens. Browser tests of the actual exported routes pass with fixture inventory for public venue tables and whole-event tables.
- A bundled Android 113.0.0 (113) build replaces the earlier development install that failed with “Unable to load script.” The device package uses the existing machine debug certificate so installation preserves the phone's sign-in/local data; it is for the requested connected-device installation, not store submission.
- Physical Samsung SM-A075F checks render the table-selection floor plan and the complete guest booking form, including name/email, selected date/time, party size and payment action. No reservation was submitted from that form.
- Repeated navigation exposed a shared-name wallet subscription collision. Each wallet subscription now has its own channel name, preventing callbacks from being added to another mounted screen's subscribed channel.
- Production transaction tests passed for venue price/hold/overlap/confirmation, exclusive-table price/capacity/release, and anonymous-buyer Paystack ledger idempotency. All test database changes were rolled back.
- The user explicitly approved one unpaid production NGN checkout. Paystack returned a valid payment URL and verified the transaction as abandoned with the correct amount/currency. Its order `d4fbfa91-62a5-41cb-9f3f-0cb4ef42192f` was released and product inventory restored. No card was entered or charged.
- Unsigned Stripe webhook returns 400; unsigned Paystack webhook returns 401; unauthenticated reconciliation and venue-checkout requests return 401.
- The stored Paystack test key was rejected by transaction initialization as invalid. Production Stripe and Paystack keys are live-mode keys. A full successful test-mode charge/webhook/email acceptance run is not verified; no production keys were changed to test keys.
- The user confirmed the iPhone is unavailable. Physical iOS installation/testing cannot be performed in this session. No TestFlight or Google Play submission is requested; distribution is to connected devices only.
- Validation evidence and build logs: `build/verification-20261103/`. The current web export has not been published to Bluehost.

Final regression run: 93 Node checks pass. Browser route checks pass for public profile tables and whole-event tables. Full-project TypeScript retains existing diagnostics; no diagnostics occur in the table screens, new avatar image component, avatar-sync hook or shared event page.

Both final native builds succeeded. iOS version/build is 113.0.0/113; deep/strict code-signature verification passes. The signed development app is packaged at `build/releases/113/60seconds-113-ios-development.app.zip` for the unavailable iPhone. Android device package: `build/releases/113/60seconds-113-final-device.apk`; its bundled JavaScript asset is 6,428,444 bytes.

The shared venue-table route wrapper now reserves the native bottom safe area. This keeps Add a table and Continue to payment above Android system navigation and the iOS home indicator. Physical Android creation-form checks show pricing, capacity, duration and availability fields; no production test table was published.

Final Android action-button check: Add a table moved from y=1502–1543 (overlapped navigation) to y=1412–1453 and opens the creation form when tapped. The final app was installed without removing user data. Temporary USB stay-awake settings were restored after testing.

The final app opens the table-creation screen with its table-name field. Process-specific logs show no script-load error, duplicate wallet-subscription error or native fatal exception. Two transient profile-fetch HTTP 522 errors were logged during the final run; the authenticated table-management/creation screens still rendered.
