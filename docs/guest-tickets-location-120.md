# Guest tickets, order lookup and signup location — 120.0.0 (120)

## Implemented and tested

1. **Guest ticket PDF:** server-generated navy 60Seconds ticket-template pages with event/venue/organiser details, a perforated QR stub and branding. One page per authoritative ticket/product/table receipt. The PDF is a downloadable attachment for both email providers; inline QRs remain previews. QRs are never replaced with an order number or lookup code. Public-storage flyers are fetched with host/path/type/size/timeout restrictions; unavailable images use the template placeholder. A bundled SIL-licensed Noto Sans font supports accented names. The saved date is labelled UTC. This is the server PDF rendering of the ticket design; it does not execute browser HTML on the server.
2. **Guest tracking code:** a separate random UUID plus checkout email opens a read-only status/recovery endpoint. Wrong email and unknown code have the same response. Rate limits, no-store responses and private database storage protect the code. Only a server-confirmed paid order can download its existing ticket PDF; lookup never initiates a payment, refund or email. `/guest-order` explains the steps; checkout and email show the code and instructions. The email link keeps the code in its URL fragment. Referral/campaign tracking was not changed.
3. **Signup location:** the hosted Auth signup trigger previously created profiles without country fields. A new profile BEFORE INSERT hook hydrates explicitly entered country, country code and city from Auth metadata before wallet provisioning. The signup UI now accepts an optional city; the client/server/fallback profile paths carry it through. Explicit profile values are retained. No GPS permission is needed and no GPS coordinates are inferred. Existing missing profile locations were not guessed or backfilled.

Versions synchronized: Expo version, Android versionName and iOS marketing version **120.0.0**; Android versionCode and iOS build number **120**. No new native archive/store release is implied by a JavaScript export.

## Validation

- **245 Node tests passed**, including PDF attachment disposition and private guest lookup cases.
- **2 real Deno PDF tests passed**; critical Edge dependency types pass.
- Synthetic two-page PDF rendered locally with PDFKit; Apple's Vision reader decoded both QRs to the exact original receipt values. Preview: `build/signup-ticket-120/sample-ticket-1.png`; PDF: `sample-guest-tickets.pdf`.
- All **59 migrations** rebuilt locally; signup location/default tracking/privacy assertions passed using synthetic records and rollback transactions. Existing OTP, RLS, settlement, concurrency and withdrawal assertions passed.
- TypeScript, lint and source secret scanning passed.
- Local headless Chrome checks passed for fragment-code prefill, paid status, PDF download and wrong-email messaging; all backend requests were mocked.
- Web, Android Hermes and iOS Hermes exports passed. Exported bundles are local build evidence, not installed-device or published-site acceptance.
- Both new migrations passed a bounded production rollback rehearsal before application.

The expanded parent-checkout type check also caught Stripe SDK/API compatibility drift. Guest checkout creators now pin `stripe@23.2.0` and use `allowed_payment_method_types: ['card']`, preserving the existing card-only route. Stripe documents that the old creation parameter is rejected on the current API in its [official migration note](https://docs.stripe.com/changelog/endive/2026-09-30/remove-payment-method-types-checkout-sessions). All six rollout handlers now pass Deno checks; real provider acceptance is still outside this run.

## Deployed and safely verified

Applied exactly `20261122100000_signup_profile_location.sql` and `20261122110000_guest_ticket_tracking.sql`. Tracking codes were added to guest metadata; historical financial, receipt and email states were not changed.

All six functions are ACTIVE, with their gateway JWT settings preserved:

| Function | Deployed version |
|---|---:|
| create-signup-user | 34 |
| guest-order-lookup | 2 |
| paystack-webhook-settlement | 43 |
| guest-checkout-webhook | 23 |
| guest-event | 28 |
| guest-checkout-reconcile | 25 |

Production catalog checks confirm the location hook, private trigger function, private guest table, and unique/present tracking codes. Eight safe live startup/CORS/invalid-input/unsigned-request checks passed. An invented lookup code/email returns 404; no customer lookup or production signup was used for acceptance. Evidence: `final-function-verification.json`, `lookup-http.json` and `migrations-applied.json`.

## Web publication completed

The user explicitly authorized: **“Publish web and activate PDF emails.”** The updated web client is published at **https://events.60secondsapp.io/guest-order**. The four email/checkout functions were activated after the lookup page was live.

- All **97 uploaded asset hashes** match the local release. The root, guest lookup, signup and shared-event routes serve the exact released index.
- Fresh headless Chrome rendered the live guest lookup page without page errors. No customer form was submitted. Local mocked integration tests separately exercised status and PDF download.
- The previous index, rewrite configuration and favicon were backed up privately on the hosting account. Old hashed assets and authentication pages were retained; the temporary candidate index was removed.
- Hosting access used the user's current signed-in Chrome session and normal Bluehost/cPanel navigation. No Git push, mobile distribution or store publication occurred.

Evidence: `web-assets-verification.json`, `published-route-verification.json`, `published-browser.json` and `published-guest-lookup.png` under ignored `build/signup-ticket-120/`.

## Remaining acceptance limits

The three fixes are implemented, tested and deployed; the web lookup UI and backend safety checks are production-verified at the boundaries stated above. Real inbox attachment delivery, real provider checkout acceptance and installed-device behavior were not exercised. No customer test email or real-money transaction was initiated, and no processing worker was invoked for acceptance.

Older emails were not resent and therefore do not contain their newly assigned lookup codes. Existing missing city/country values were not guessed or backfilled. Version 120.0.0 (120) is configured for Android/iOS, but no new native archive or mobile/store release was produced. These changes do not close unrelated blockers in the earlier production-readiness audit.
