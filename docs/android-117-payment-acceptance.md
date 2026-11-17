# Android 115.0.3 (117) — payment selection verification

Built and installed on the connected Samsung SM-A075F (Android 16) on 16 November
2026. ADB confirms versionCode 117 and versionName 115.0.3. Both app.json and the
native Gradle configuration were updated consistently. This is a development APK
served by the local Metro server over USB forwarding on port 8081.

## What changed

- The cart now has working, selectable payment methods. NGN offers Card · Paystack,
  Bank transfer · Paystack, and Card · Stripe. Other currencies offer Stripe card.
  Payment routing follows the chosen method and cart currency, independent of the
  buyer's nationality.
- The chosen Paystack channel is passed to its initializer and stored in payment
  metadata. A pending checkout with different method terms is rejected explicitly;
  an old hosted URL is not silently substituted for a newly selected method.
- Fixed the Paystack modal lifecycle: changes to processing status no longer reset
  the selected channel, hosted URL or reference. Closing the interface does not
  report that the provider transaction itself was cancelled.
- Stripe receives explicit card mode for new card checkouts. Retries retrieve and
  validate a previously bound PaymentIntent. An already-successful intent uses
  verified settlement; an existing pending intent is not initialized a second time.
- Checkout no longer waits for the unrelated wallet-store loading flag. The cart
  summary is inside the scrollable list, and its footer includes bottom safe-area
  padding so the Checkout button remains reachable above system navigation.
- Known item/event eligibility failures have actionable customer messages.

Updated Supabase functions are ACTIVE with JWT verification enabled:
`paystack-create-order-checkout` version 20 and `stripe-create-checkout` version 64.
Existing Supabase access was used; no payment-provider secret or mode was changed.

## Executed checks

- Full Node suite: **200 passed, zero failed, zero skipped**. New regression cases
  verify method/currency routing, actual Paystack request channels and durable
  metadata, retry reuse, changed-method rejection, invalid-channel rejection,
  Stripe card parameters and stored-intent reuse.
- TypeScript, lint and working-source secret scan: passed.
- Native `:app:assembleDebug --offline`: succeeded in 1m 27s; 518 tasks.
- APK installation: ADB returned Success; app data preserved.
- On-device cart renders the three NGN payment selections and the scrollable summary.
- Hosted Paystack checkout opens in the phone's browser. Database verification shows
  order **#0000031**, **NGN 4,160**, selected channel **bank_transfer**, provider
  initialization successful, payment pending, reservation retained, zero receipts.
  This confirms initialization and selected-method handoff; it does not establish
  successful payment.
- **Payment-screen acceptance check completed:** the user confirmed that provider
  security verification finished and the payment screen opens correctly. The user
  did not complete payment; successful payment/settlement remains untested.
- Added a development-only sample ticket in Profile → Purchases using the actual
  ticket renderer. It is labeled SAMPLE / NOT VALID FOR ENTRY, has an invalid sample
  QR payload, and cannot be downloaded or shared. It creates no database records
  and does not count toward purchases. Release builds omit the preview.
- A health-only invocation of the existing worker confirms **both Stripe and
  Paystack are live**. No charge was submitted by the agent. Stripe's physical
  PaymentSheet and a completed real payment were not verified during this run.

APK: `android/app/build/outputs/apk/debug/app-debug.apk`.
SHA256: `20536b4169728bea5a09f9cca66296974ac7becfd42f2cb354f0a255dec87205`.
Logs and initialization evidence: `build/android-117-verification/`.

## Testing on the phone

Choose the payment method before starting checkout. For Paystack, continue with
that method, complete any provider security verification, and follow the displayed
payment instructions. After paying, return to the app and use **Check payment
status**; payment is fulfilled only after server verification. The current hosted
checkout is live: do not use test card numbers or submit a transfer unless you
intend to pay the displayed amount.

An initialized checkout keeps its provider, method and reservation. Resolve that
attempt before changing provider or payment terms; this protects against duplicate
payments. No outstanding attempt was force-released or falsely marked paid.

Firebase/FCM work is deferred at the user's request. The unrelated downloaded
Firebase file was not used; no Firebase dependency, configuration or credential was
added. Android push delivery is not claimed as verified. Expo/Play remote version
counters and store distribution were not changed by this local-device build.

## Ticket reference layout revision

Profile purchases and exported ticket PDFs now follow the supplied reference:
organiser flyer, event heading with weekday/date, aligned Starts/Category/Price/
Venue/Conditions/Organiser rows, perforated divider, lower receipt-specific QR
stub, ticket number and SOLD ON 60SECONDS footer. The existing navy/blue palette
is retained. Real venue addresses are enriched from accessible event/video data;
missing organiser conditions remain explicitly unavailable. No entry rules or
payment records were invented. Sample rules/address appear only on the labeled
development preview. PDF cache filenames were revised to avoid reusing the old
layout. TypeScript, lint and all 200 tests passed after this revision.

The Android device disconnected before visual verification of this revision;
ADB reported no connected devices. The previous sample screenshot predates this
layout update and is not evidence of the revised design.
