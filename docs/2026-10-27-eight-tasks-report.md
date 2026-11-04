# Eight-request implementation and verification report

Date: 27 October 2026

## Delivery status

The requested app/backend paths have been reviewed and the gaps described below have been fixed in the workspace. Some features were already implemented locally before this request; they were retained and tested rather than replaced.

**This report distinguishes implementation from production acceptance.** This work has not applied production migrations, deployed Edge Functions, published the website, distributed new mobile binaries, sent test push notifications/emails to real people, or charged a payment. The earlier 109 archive does not contain changes made during this request. A new native build is required, including the new Expo Print module.

## 1. Dynamic video feed

Both private and business home feeds expose **For you** and **Recent**, including when the nearby feed is empty. Switching to either option requests the global feed. For you uses a fresh session seed on refresh/foreground return; database ordering covers all video dates and keeps pagination stable within that seed. Recent sorts by upload date descending, then creation date and ID for ties/legacy records. Switching back requests a new randomized feed.

A missing database RPC previously caused the fallback to use newest-first ordering, recreating the reported symptom. The fallback now retrieves video IDs across dates, orders them by a session-seeded hash, and fetches only the selected page's full records. Repeated pages within one seed remain stable; reopening with a new seed changes the order. The database RPC remains preferable for large collections because the compatibility fallback holds the ID list in memory.

Verification: JavaScript checks for missing-RPC randomization, inclusion of older dates, stable/non-overlapping pages and new seeds; real PostgreSQL checks of the randomized RPC with videos spanning several years. A one-video collection necessarily cannot show a different video.

Files: `lib/video-feed.ts`, `store/video-store.ts`, both home screens, `20261004100000_random_video_feed.sql`.

## 2. New-message and follower notifications

Existing database triggers create one outbox job per direct message, group message recipient, or new follower. The protected delivery function sends Expo pushes to registered devices. Payloads identify the chat or follower profile, rather than just opening the home screen.

Corrections made:

- Notification navigation waits for an authenticated user, including cold-start handling.
- The same response is not processed repeatedly during component rerenders.
- Handled responses are cleared so a later ordinary app launch does not reopen an old notification.
- An asynchronous response cannot navigate after its subscription is cleaned up.
- Locally generated group notifications for shared events now open their chat, consistent with other messages.

Verification: PostgreSQL trigger tests produced two direct-message jobs, one group-message job and one follower job, with the correct recipient/chat/profile targets and no notification to the sender. Navigation tests also verify direct/group chat routing, follower profile routing, response deduplication and cleanup. These tests create synthetic rows in an isolated database; they do not send messages to users.

Production dependencies: notification permission; correct APNs/FCM credentials; device registration; deployed push migration and `deliver-push`; configured worker secret and scheduled invocation. Queue creation is verified locally. Delivery to a locked/killed physical Android or iOS app still requires end-to-end acceptance testing.

## 3. Deals category

**Deals** is available in Discover for both account types. Selecting an entry opens the event purchase page, where the buyer can select its offers and proceed to checkout.

The previous category filtered only the latest 60 general events. It could miss an older event with available products. Deals now queries saleable events directly using active, positive-price, in-stock products, public visibility, an open/published state and a future event end time. It no longer depends on an event appearing in the latest general results. The shared lifecycle helper also honors event dates when a stale database status still says “open.”

The current list displays up to 60 matching events. Sold-out, inactive, cancelled and ended events do not qualify. Seat tables remain their own booking inventory; Deals eligibility currently requires a saleable product/service offer.

Files: `lib/event-queries.ts`, `components/TrendingEventsDiscoverScreen.tsx`, `utils/event-status.ts`.

## 4. Older profile videos

Profile video actions in both account tabs and the other-user profile screen now navigate directly to `/event/<videoId>`. Playback no longer depends on the selected video being present in the randomized home-feed page.

The dedicated screen fetches the authoritative video by ID, shows loading while it fetches, clears stale content when the ID changes and distinguishes unavailable media from an ended event. Event age does not block watching a stored video. Purchases/attendance can still close independently when an event ends.

A second cause was found in playback: the event screen supplied `paused=true`, while the native player's `shouldPlay` ignored manual play state. Manual playback now uses its actual playing state; automatic feeds use their parent pause state. The event viewer starts playback and allows tap-to-pause, subject to foreground/focus state. Existing signed storage URLs are normalized by the video service.

Verification: regression checks exercise manual/automatic pause behavior, focus and background restrictions. Deleted objects, corrupt original files and unavailable external hosts cannot be restored by a player change.

## 5. Business event images/flyers — detailed report

### Supported media combinations

| Combination | Creation | Editing |
| --- | --- | --- |
| Image/flyer only | Business upload can create an event without a video. | Owner can replace its flyer or attach its first video. |
| Video only | Existing video creation remains available. | Owner can replace the video or remove the cover flyer. A generated video thumbnail can serve as the event image. |
| Image/flyer and video | Selected flyer is used as the event cover alongside the video. | Owner can replace either medium independently. |

The current model has **one event cover image/flyer and one optional linked video**. This is not a multi-image gallery or multiple-video playlist.

### Where owners find the controls

Business owners open **My Events → Edit event images & video**. The action is on the event card and remains available for organizer history, including events whose public purchase page has expired. An authenticated business owner can also open the same editor from the public event page while it is available.

The editor displays the current cover, indicates whether a video is selected, and provides add/replace/remove actions for each medium. It requires at least one medium, validates selected video duration, disables actions during saving, displays upload/database errors, and returns only after a successful save. Removing the event's video association does not delete the historical video object or purchase receipts.

### Gaps fixed

1. Flyer-only events had no complete media editor for attaching a video later. The new editor covers all combinations.
2. The previous upload edit path let the user select a replacement video but saved only metadata. It now uploads and saves the replacement file and clears the old branded-export reference.
3. Closing/resetting a business upload did not clear the selected flyer. It now clears the flyer with the rest of the draft.
4. Flyer-only creation did not take the upload launch lock. It now prevents duplicate launches while creating the event and its offers.
5. The old public flyer action could appear successful when an owner-filtered update matched no row. Media editing now uses an authorized database function and treats failures as failures.
6. Ticket cards showed the flyer, but the manually generated PDF omitted it. Native PDF generation now embeds the cover and the receipt's QR in the printable document.
7. Several receipts in one order could collide in the PDF cache. Each filename now includes its unique receipt ID.

### Authorization and persistence

`20261027120000_business_event_media.sql` introduces `save_event_media`. It authenticates the caller, checks the profile's business account type, locks the event, and verifies ownership server-side. Hiding the UI is therefore supplemented by an independent database authorization check.

The function atomically adds/updates the video's database record and the event's media association. Attaching a first video carries over event title, description, timing and location. Replacing a video clears the previous watermarked URL. Invalid URLs, excessive duration, another owner's event and an empty media selection are rejected.

Files are uploaded before the database save. A failed database save leaves the event unchanged; an uploaded but unreferenced storage file may need later cleanup. This is not a cross-storage/database transaction.

Private users do not see the business editor action, and a direct private-user attempt is rejected by the editor's profile check and the database function. The normal private video workflow remains available.

### How the flyer reaches tickets

The event cover is stored in `events.image_url`. New purchase receipts copy it to `ticket_receipts.ticket_image_url`, preserving the image associated with the purchase. Ticket cards render this field. Guest confirmation emails include the stored event image alongside the distinct receipt QR codes.

Native PDF downloads now use the SDK-compatible `expo-print` module. The app downloads the flyer and embeds it as image data in the printable HTML, together with a QR generated from **that receipt's `qr_code_data`**. It does not use an order number as a substitute QR. Browser ticket downloads open a print preview where the buyer can save a PDF. Each receipt has a separate cached PDF filename.

Changing a cover affects future receipts. Existing issued receipts keep their saved purchase image and QR; editing an event does not rewrite a buyer's issued ticket.

### Verification completed

- Real PostgreSQL tests: flyer-only save; attach first video; replace a video without duplicating its record; video-only edit; flyer-only edit; reject removing both; reject an overlong clip; reject private-user edits.
- Guest mixed-order fulfillment copied the event flyer to the ticket/product receipts.
- HTML/PDF-content tests check flyer inclusion, escaped event/title text, rejection of unsafe image URLs and distinct QR images.
- Cache tests check that separate tickets/products in the same order have different PDF filenames.
- Expo Print installed at SDK-compatible version `15.0.8`; iOS pods integrated successfully.
- Web export succeeds. Native PDF rendering and camera-library selection still need device acceptance after a new native build.

Implementation: `app/edit-event-media.tsx`, business upload, `app/my-events.tsx`, `app/[id].tsx`, `components/OrderPDFList.tsx`, `utils/ticket-document.ts`, new media migration.

Reference: [Expo Print's native PDF and image support](https://docs.expo.dev/versions/v54.0.0/sdk/print/).

## 6. Vouchers

The existing database-backed voucher implementation was retained and tested. Business voucher creation normalizes the code and discount fields. Checkout validates active state, expiry, usage limits, minimum spend, maximum discount, business ownership and product restrictions. The order trigger recalculates the expected discounted amount server-side; an incorrect client total is rejected. Paid-order usage is recorded once even if the payment callback repeats.

Verification: JavaScript discount tests cover percentage/fixed values, rounding, caps, invalid/expired/inactive/exhausted vouchers, wrong sellers/products and minimum purchases. PostgreSQL checks cover normalized voucher creation, a 25% discount on a marked price, paid usage and idempotent repeated updates, plus expired-code rejection. This is a local database end-to-end check, not a real processor charge.

The public guest event page currently supports guest purchases but does not expose voucher entry. Voucher entry is in the app checkout. Provider-specific live payment acceptance remains outstanding.

## 7. Separate ticket/product QR codes and fulfillment

Mixed guest purchases produce distinct ticket and product receipt rows under one order number. Each admission ticket has its own QR; a product receipt has a different QR and its purchased quantity. Scanning admission leaves the order **Partially completed** while other receipts remain active. Redeeming the final receipt changes it to **Completed**. An already redeemed QR is rejected.

The PDF cache collision described in task 5 was an additional display-level violation: even distinct receipt rows could appear to share a QR through a reused file. The receipt-specific filename fixes this.

Verification: real PostgreSQL mixed ticket/drink checkout, paid fulfillment, distinct QR strings, event-image snapshots, first redemption, final redemption and double-scan rejection. The existing paid table-reservation regression suite also passes.

## 8. Shareable event web page

New event links now use the requested compact shape:

`https://events.60secondsapp.io/<eventId>`

Legacy `/web-event/<eventId>` links remain supported. Public pages read the event's saved currency. Existing checkout provides guest email entry, server-calculated product/table purchases, Stripe checkout, signed fulfillment, separate receipt QR codes in the email, delivery retry/reconciliation and an account-registration link.

Server-side expiry remains exactly 48 hours after event end, with start time as the fallback when no end is saved. Checkout closes at the event's ending time; the page can remain readable during the subsequent retention window. Expired API requests return HTTP 410. Public routes use SPA hosting rewrites so a direct link or browser refresh can reach the app.

Verification: root-link generation and legacy compatibility; exact expiry boundary tests; actual guest reservation/fulfillment SQL; email payload tests preserve buyer/sender/inline QR references and retain failed deliveries for retry. No real payment or customer email was triggered.

## Validation and release work

### Local results

- **80 JavaScript regression checks passed.**
- Existing paid event/table checkout SQL regressions passed in disposable PostgreSQL 17.
- Business-media, voucher and mixed-receipt redemption SQL checks passed.
- Direct/group message and follower outbox SQL checks passed.
- Randomized feed SQL checks passed.
- Production web export passed.
- Android native Kotlin compilation passed with Expo Print included.
- iOS pods integrated Expo Print successfully.
- Full repository TypeScript checking still reports existing unrelated app errors and Deno Edge Function environment errors. Focused checks of the new media/document/feed/query/notification/player code have no new diagnostics.

### Release dependencies

1. Review the project's applied migration history. Apply only missing prerequisite feed, notification, voucher, partial-redemption and guest-checkout migrations, followed by `20261027120000_business_event_media.sql`. Do not run the fixture SQL in production.
2. Deploy/verify `deliver-push`, `guest-event`, `guest-checkout-webhook`, `guest-checkout-reconcile` and the current payment functions. Confirm worker schedules, APNs/FCM, Stripe webhook/Connect settings and email-provider configuration.
3. Publish the new web export with its SPA rewrite rules.
4. Build and distribute new Android/iOS binaries. An OTA JavaScript update alone cannot install Expo Print.
5. Run device acceptance: reopen/switch feed; oldest profile video; message/follower pushes with app foreground/background/killed; all three business media combinations and private restrictions; actual saved ticket PDFs; voucher checkout; entrance/product scans in both orders; and guest test-mode payment plus delivered email.

Test fixtures and their databases were isolated from production. No production migration/deployment, real payment, message, push or receipt email was performed in this work.
