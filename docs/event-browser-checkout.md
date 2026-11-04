# Event browser pages and paid table seats

> Profile table bookings, whole-table event offers and NGN Paystack checkout are updated in [the November booking release](2026-11-03-table-bookings.md). The implementation history below predates that release.

## What changed

New event links use `https://events.60secondsapp.io/<event UUID>`. Legacy `/web-event/<event UUID>` links remain supported. Configure `EXPO_PUBLIC_SHARE_BASE_URL` to use a different public HTTPS origin; native development builds no longer share localhost. Existing `/<event UUID>` links still render the same page. Video-only links retain their video route. The video share action attaches the original video to WhatsApp; the separate Share Page action sends the event booking link.

The previous `public/index.html` was a redirect placeholder without the React root. It is now a proper Expo browser entry template. A platform-specific sharing adapter avoids loading the native RNShare module in browsers, and browser deep links no longer mount the home feed/EULA modal behind the public event page. `/web-event/[id]` now uses live event data and verified Stripe checkout instead of the old mock-event screen and simulated payment success.

Owners open **My Events → Manage tables & paid reservations**, including for draft or ended events. Tables are also manageable on the event screen. Each table has a name, seat capacity, price per seat in the event currency, and visibility. Capacity cannot be reduced below held/paid seats. Price/name changes apply to future orders; existing bookings retain their purchase snapshot.

Buyers choose tickets, products and table seats together on the public page, provide an email address, and pay through Stripe Checkout without installing or signing into the app. Prices include the existing 4% platform fee. Seats are sold individually: different parties can book remaining seats at the same named table. To reserve every seat, select the table's entire remaining capacity. This is not an exclusive-table booking model.

Profile → My reservations shows only confirmed, paid event table reservations associated with the signed-in user's **verified email**. An anonymous web buyer can later sign in with that same email to see the booking. Owners see paid attendee details on their event's management screen. Existing legacy venue/table records remain in the database, but the old unpaid creation RPC is disabled and the former profile booking entry points are retired. Legacy unpaid bookings are not silently converted into paid event reservations.

## Payment and availability guarantees

- Product inventory and table seat holds are acquired in one database transaction. Table rows are locked in a consistent order; simultaneous checkout cannot allocate more seats than capacity.
- A hold is not a confirmed reservation and is not exposed in a buyer's profile. Only the service-role payment fulfillment RPC confirms it after the existing signed webhook validates payment amount/currency.
- Duplicate completion/expiry callbacks are idempotent. Cancelled or expired unpaid sessions release product stock and seat holds through the webhook or reconciliation worker. Closing the browser alone does not release seats immediately, because payment could still be processing.
- Stripe Checkout sessions expire after 30 minutes. The existing reconciliation worker recovers missed notifications and uncertain session-creation failures after one hour. Schedule it regularly; otherwise abandoned sessions can leave inventory held when webhooks fail.
- A redirect containing `purchased=1` never marks an order paid. Confirmation email contains purchased item QR codes and table reservation references/QR codes after fulfillment. Table QR codes identify reservations for staff; they do not add a new admission/redemption scanner workflow.
- The existing event-link retention rule still expires public pages 48 hours after the event ends. Checkout closes at event end (or start if no end is configured).

## Deployment procedure for future updates

1. Review/apply the prerequisite migrations `20261004130000_guest_event_checkout.sql` and `20261005100000_table_reservations.sql` if missing, then apply `20261014100000_paid_event_tables.sql`. Use the project's reviewed migration process; do not blindly push all unrelated pending migrations in this workspace.
2. Deploy the updated functions:

   ```sh
   supabase functions deploy guest-event
   supabase functions deploy guest-checkout-webhook
   supabase functions deploy guest-checkout-reconcile
   ```

   The webhook and reconciliation deployments include the modified shared fulfillment module. These functions use their existing `verify_jwt = false` configuration: checkout is public; the webhook checks the Stripe signature; reconciliation checks `GUEST_WORKER_SECRET`.
3. Configure Supabase function secrets: `STRIPE_SECRET_KEY`, `STRIPE_GUEST_WEBHOOK_SECRET`, `PUBLIC_EVENT_BASE_URL=https://events.60secondsapp.io`, `GUEST_EMAIL_PROVIDER=sendgrid`, `SENDGRID_API_KEY`, `POSTMARK_FROM_EMAIL=support@60secondsapp.io` (receipt sender), and `GUEST_WORKER_SECRET`. Keep Supabase service-role and Stripe secret keys server-side. Each seller needs a Stripe connected account with charges and payouts enabled. Checkout returns an explicit error when seller payments are unavailable.
4. Register Stripe's webhook endpoint `https://<project>.supabase.co/functions/v1/guest-checkout-webhook` for `checkout.session.completed` and `checkout.session.expired`; use its signing secret above. Schedule an authenticated POST to `guest-checkout-reconcile` every 5–10 minutes, using `Authorization: Bearer <GUEST_WORKER_SECRET>`.
5. Configure the web build's public Supabase URL/key and `EXPO_PUBLIC_SHARE_BASE_URL=https://events.60secondsapp.io`, then run:

   ```sh
   npm run build:web
   ```

   Publish **dist**, not **public**, to the hosting service serving `events.60secondsapp.io`. The repository includes `vercel.json` and `public/_redirects` (copied into dist for Netlify-style hosts). On another host, serve real assets first and rewrite browser routes to `/index.html` with HTTP 200. For Nginx, use `try_files $uri $uri/ /index.html;` in the site's location block. Ensure the domain's HTTPS certificate is valid. Do not configure `/web-event/*` to force an app-store/custom-scheme redirect. Expo's router `origin` setting alone does not deploy or host any page.
6. Rebuild/distribute the native app so its sharing action uses the new HTTPS URL. Previously sent localhost links cannot be fixed remotely; share them again after updating.

## Production deployment status — 14 October 2026

- Published the browser build to **https://events.60secondsapp.io** on Bluehost. DNS resolves to `50.6.34.248`; HTTPS and direct event routes respond successfully. The marketing homepage at `https://60secondsapp.io` remains on its existing host.
- Bluehost document root: `/home2/anpzkbmy/public_html/website_db2f442f/event-app-static`. Deployment archive: `build/event-deployment/event-app-events-domain.zip`. The included `.htaccess` handles SPA deep links.
- Applied the guest checkout and paid event table migrations to Supabase project `rvvujgbaswecqohixgog`; the legacy table migration was already applied.
- Deployed `guest-event`, `guest-checkout-webhook`, and `guest-checkout-reconcile`.
- Registered Stripe live webhook `we_1UQOKEJTbyjuWarpYuDmWj2x` for completed/expired checkout sessions and configured its signing secret. Configured the public checkout return origin to the events subdomain.
- Scheduled authenticated reconciliation every five minutes with the worker token in Supabase Vault; an authenticated invocation returned HTTP 200.
- Verified live public event API HTTP 200, unsigned webhook rejection HTTP 400, unauthenticated worker rejection HTTP 401, and database permissions preventing clients from confirming payments.
- Opened [a published event](https://events.60secondsapp.io/web-event/426d4519-dcc2-4450-848c-f70a66bb28b3) in Chrome using the live API. The page rendered event details, table-seat section, email field and checkout UI. This event currently has no inventory listed.
- Configured receipt delivery with `GUEST_EMAIL_PROVIDER=sendgrid` using the existing valid `SENDGRID_API_KEY`. SendGrid confirms `60secondsapp.io` is authenticated and accepted the inline-QR receipt payload in sandbox mode (HTTP 200, no email sent). The old Postmark token is invalid and is not used by guest checkout. Paid bookings are confirmed independently of delivery; reconciliation retries failed email.
- No real payment was charged. A complete payment/email acceptance test and physical-device WhatsApp test remain outstanding. Native app changes must still be distributed to users so their sharing actions generate the new subdomain links. Existing links on the marketing domain are not rewritten by this deployment.


## Verification

Run `node --test tests/event-links.test.cjs tests/commerce-rules.test.cjs` for link and money rules. In an **empty disposable local PostgreSQL database**, run `tests/paid-event-tables-fixture.sql`, then `tests/paid-event-tables.sql`. Never run the fixture in a real Supabase project: it creates minimal stand-in tables and roles.

The SQL regression checks mixed carts, server-calculated prices, held versus confirmed seats, over-capacity rejection, capacity edit protection, session mismatch, repeated fulfillment/release, stock rollback on failed carts, owner authorization, verified-email privacy, client payment-forgery rejection and the disabled unpaid RPC.

Before release, use Stripe test mode to complete a mixed ticket/product/table purchase from a WhatsApp link in a logged-out phone browser. Check direct URL open and refresh, cancellation/expiry, the emailed confirmation, same-email profile history, and owner reservation list. Test two simultaneous purchases for the last seats. No real card charge is needed for this acceptance check.

References: [Expo web hosting and SPA rewrites](https://docs.expo.dev/guides/publishing-websites/), [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment).

## Local validation results

- Eight link/pricing regression tests passed.
- Paid reservation SQL regressions passed on disposable PostgreSQL 17.
- Two simultaneous requests for three of the last four seats produced one success and one insufficient-seats error.
- Production Expo web export succeeded. Headless Chrome opened the exported `/web-event/<id>` route with mocked event data and rendered tickets, table availability and guest checkout without the native-module error or startup EULA overlay. This browser smoke test does not verify live API/Stripe connectivity.
- Focused TypeScript analysis reported zero diagnostics across 13 changed frontend files. Full-project checking remains blocked by unrelated existing app diagnostics and the Node checker not supporting the Deno function environment.
- Live hosting and backend deployment are verified above. Payment/email acceptance and physical-device WhatsApp checks remain outstanding.

## October 16 sharing and profile corrections

- New uploads retain `eventId` in the local video object, so sharing immediately opens the event booking page.
- Older `/video/<video ID>` and `/web-video/<video ID>` links resolve their public linked event before rendering, exposing the same tickets, drinks, reservation products, other products, and paid seat tables as `/web-event/<event ID>`.
- A product called “table” created through Other Offers is a reservation product. It appears among offers; seat tables created in Manage event tables appear in the separate seat section. Existing records are not converted between these inventory models.
- Profile photo uploads use the native media reader, check database-save errors, and preserve intentional avatar removals. An in-flight older auth refresh cannot overwrite a newly saved photo.
- These frontend corrections require publishing the new web export and distributing a new native build. No database migration is required. Deleted video URLs are not restored by matching event names.

### October 16 deployment verification

- Published `build/event-deployment/event-app-20261016-fixes.zip` through the logged-in Bluehost File Manager into the existing event-site document root. Package includes only the web entry, assets, bundle, favicon, metadata and rewrite configuration; local videos and unrelated standalone pages were excluded.
- Saved the previous site at `/home2/anpzkbmy/event-app-backup-20261016.zip` before deployment.
- Live event route and new `entry-ec21919c4b2af47e4af46f515a433494.js` bundle both returned HTTP 200; the live HTML references the new bundle.
- Thirty regression tests passed. Local browser testing with fixture inventory verified legacy video-link redirection and all five inventory presentations: tickets, drinks, reservation offers, other products, and seat tables.
- Full TypeScript diagnostics are unchanged from the previous run. Native profile fixes still need a newly distributed mobile binary and physical-device acceptance testing; the iOS workspace is open in Xcode.
- Repeated the browser inventory test against the deployed website using mocked API inventory: legacy redirect and all offering types passed. No event was created and no payment was attempted.
