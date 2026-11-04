# September 2026 change request

Implemented in the existing Expo app and Supabase backend. No production migrations, functions, payments, messages, or deployments were executed during this work.

## Feature map

| Request | Implementation |
| --- | --- |
| Dynamic feed / Recent | Session-seeded database ordering across all video dates, stable pagination, foreground refresh, For you / Recent controls in both feeds. |
| Message / follower push | Device registration, database outbox for direct/group messages and follows, protected delivery worker, notification routes to chat/profile. |
| Deals | Discover category uses active, in-stock products; opens the event purchase page. |
| Old profile videos | Explicit video lookup refreshes cached records; event detail loads videos independently of the current feed. Missing/deleted storage objects cannot be recovered by code. |
| Business flyers | Business upload supports a flyer plus video or a flyer alone. Flyer editing is available on the shared event page; video editing can replace a flyer. Ticket cards and guest order emails display it. Existing PDF layout is unchanged. |
| Vouchers | Database CRUD replaces mocks, compatibility migration normalizes older schemas, validation covers expiry/limits/owner/product/minimum/caps, order validation and paid-order triggers handle usage. Paystack uses the same marked-price discount basis. |
| QR separation | Existing individual ticket/product receipts retained. Redemption now uses `partially_completed` until the final scan, and payment updates preserve fulfillment progress. |
| Event website | `/{eventId}`, public event details, guest email checkout, registration link, server-side 48-hour expiry, Stripe Checkout, inventory reservation, signature-verified fulfillment, separate emailed QR attachments, recovery worker. Historical `/{videoId}` links still redirect to videos. |

## Deployment required

1. Apply these migrations in timestamp order using the normal staging/release process:
   - `20261004100000_random_video_feed.sql`
   - `20261004110000_partial_redemption.sql`
   - `20261004120000_push_notifications.sql`
   - `20261004130000_guest_event_checkout.sql`
   - `20261004135000_voucher_schema.sql`
   - `20261004140000_voucher_redemption.sql`
   The voucher migration intentionally rejects duplicate codes that differ only by case/whitespace. Resolve those duplicates before applying it. Preserve existing RLS; guest order and queue tables grant no anonymous reads.
2. Deploy `guest-event`, `guest-checkout-webhook`, `guest-checkout-reconcile`, `deliver-push`, and the updated `paystack-create-order-checkout`.
3. Configure server secrets:
   - `STRIPE_SECRET_KEY` and `STRIPE_GUEST_WEBHOOK_SECRET`.
   - `PUBLIC_EVENT_BASE_URL`, matching the deployed web origin and app `EXPO_PUBLIC_SHARE_BASE_URL`.
   - `POSTMARK_API_KEY`, `POSTMARK_FROM_EMAIL` (a verified sender).
   - Random, distinct `PUSH_WORKER_SECRET` and `GUEST_WORKER_SECRET`.
   - `EXPO_ACCESS_TOKEN` if Expo enhanced push security is enabled.
   Supabase supplies the function URL and service-role credentials. Never put worker/payment/email secrets in Expo public variables.
4. Register the Stripe endpoint `/functions/v1/guest-checkout-webhook` for `checkout.session.completed` and `checkout.session.expired`. Use its own signing secret. Stripe webhook retries and the recovery worker reuse the same order/receipts.
5. Schedule POST requests to `deliver-push` every minute with `Authorization: Bearer <PUSH_WORKER_SECRET>`, and `guest-checkout-reconcile` every five minutes with `Authorization: Bearer <GUEST_WORKER_SECRET>`. Recovery handles stale reservations, missed callbacks, and unsent guest emails. Alert on outbox jobs reaching ten delivery attempts.
6. Deploy the Expo web export with SPA fallback so direct `/{eventId}` requests serve `index.html`. Rebuild native apps with the notification plugin and valid APNs/FCM credentials.

Guest web payments use Stripe Connect destination charges, so sellers need an enabled connected Stripe account. App Paystack/Twint flows remain available. Three-decimal currencies and ISK are explicitly rejected by guest checkout; standard two-decimal and Stripe zero-decimal currencies use their correct units. Guest checkout currently accepts cards. This release does not provide a Paystack/Twint guest web flow.

## Verification

- `node --test tests/commerce-rules.test.cjs`: voucher boundaries, rounding, ownership/product restrictions, expiry boundaries, currency units.
- `npx expo export --platform web --output-dir /tmp/60seconds-change-request-web`: browser bundle verification.
- Full repository TypeScript checking has pre-existing app errors and includes Deno Edge Functions in the Expo compiler configuration. Check changed-file diagnostics separately; use Deno/Supabase tooling for Edge Function type validation.
- SQL functions and external delivery were not executed locally: no local PostgreSQL/Deno runtime was available.

Before releasing, verify in staging: random/recent pagination and background resume; oldest profile video; background/killed-app notifications and navigation; business flyer-only and mixed-media events; private account UI; voucher creation, fixed/percentage checkout, expired/invalid codes and retry usage; a mixed ticket/product order scanned in either order (including concurrent scans); guest payment/cancellation/expired session; email retry without duplicate receipts; event-link expiry at exactly 48 hours; and seller payouts. Test with Stripe test mode and test email recipients.

Implementation references: [Stripe Checkout payment status](https://docs.stripe.com/api/checkout/sessions/object), [Expo push delivery](https://docs.expo.dev/push-notifications/sending-notifications/).
