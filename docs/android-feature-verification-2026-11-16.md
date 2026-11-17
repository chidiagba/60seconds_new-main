# Android ticket and Deals verification — 16 November 2026

Verified on connected Samsung SM-A075F, Android 16, app 115.0.3 (117), using the
current development JavaScript served over USB/Metro.

- Profile Purchases renders both the labeled development sample and actual
  purchased tickets with the new blue layout: flyer/fallback, event/date, detail
  rows, organiser, perforated separator, QR, ticket number/status and branded footer.
  Existing historical tickets without artwork or entry conditions show honest
  unavailable labels. No sample purchase/receipt was written.
- Fixed a navigation issue found during this run: `/profile?tab=orders` now
  preserves the Purchases tab when redirecting to the account's profile screen.
  Added tests for personal/business accounts and other-user privacy.
- Confirmed updated PDF files were generated in the Android app's ticket storage.
  Retrieved one 94,524-byte file and verified its PDF header. Full visual PDF
  rendering was not inspected during this run.
- Discover → Deals displays the two currently eligible events, with no ambiguous
  relationship error. The live endpoint independently confirms two events and
  no next page. Both public event endpoints returned HTTP 200.
- A Deals card opens the booking page, with purchasable ticket/product prices,
  stock and quantity controls. No checkout was initiated.
- The Android system share sheet opened with the correct event HTTPS URL,
  event title, uploader, venue, date and description. No recipient was selected
  and no message was sent. Cancel returned to the app.
- TypeScript and lint passed. Node suite: 211 passed, zero failures or skips.

Evidence: `build/android-feature-verification/` includes ticket/list/booking
screenshots, the event share payload, the generated PDF and validation logs.
Screenshots/PDF contain the account's existing tickets and should be treated as
private verification artifacts. The device switched to other apps intermittently;
60seconds was brought back to the foreground at completion. iOS was not physically
retested during this Android run; its prior release-bundle verification remains
recorded in the Deals implementation report.
