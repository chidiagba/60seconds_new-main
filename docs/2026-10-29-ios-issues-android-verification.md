# Currency, video, voucher and event image repairs

## Changes

- The supplied Happy Vibes event stored USD while its three offers stored NGN. Repaired existing events with one offer currency and installed a product trigger to keep new and edited event currencies aligned, including writes from older installed apps. Shared-page reads also resolve and validate offer currency.
- Added an inline, user-controlled video player to shared event pages. The guest-event API now returns linked video metadata and falls back to its thumbnail when the event image is missing.
- Removed a video URI cleanup that could unload a replacement clip. Android now starts with ExoPlayer and retains the decoder fallback. Added playback retry controls and handled an initially unavailable AppState value.
- Production vouchers lacked discount_type, discount_value and product_id, and required creator_id. Installed canonical fields and a normalization trigger compatible with older percentage/amount clients, without changing ownership policies. Added legacy client handling and visible creation errors.
- Native event details now display the event image. Installed the existing save_event_media RPC, which production was missing.
- Commented three stray expressions in an otherwise commented legacy business feed implementation; they referenced an out-of-scope variable at module load.

## Deployed

- Supabase project: rvvujgbaswecqohixgog. Deployed guest-event and applied/recorded migrations 20261027120000, 20261029140000 and 20261029143000.
- Bluehost event-site folder: /home2/anpzkbmy/public_html/website_db2f442f/event-app-static.
- Previous website backup: /home2/anpzkbmy/event-app-backup-20261029.zip.
- Published archive: build/event-deployment/event-app-20261029-fixes.zip.
- Live entry bundle: entry-9ac0628740b16a36ee431b68205237fb.js.

## Verification

- Android debug build succeeded and was installed on connected Samsung SM-A075F, serial R8VL102MZHZ. Metro remains on port 8081 with USB reverse configured.
- Device screen showed voucher creation success, event image/video, and ticket/cocktail prices of 1040.00 NGN including the existing fee.
- The actual event video reported isLoaded=true, isPlaying=true, positionMillis=10548, durationMillis=13026 and isBuffering=false through the Android debugger.
- The live Chrome page loaded the event image, displayed NGN for all offers and total, and played the 13.026-second video to completion without a media error. Inline playback and native controls are enabled.
- Database audit found zero mismatches among events with one active priced-offer currency. A rolled-back transaction verified synchronization after changing offer currencies.
- Rolled-back production tests exercised modern voucher creation, fixed-discount update and legacy percentage creation under the authenticated ownership policy.
- All 83 Node regression tests passed. git diff --check passed. Full TypeScript checking still reports 206 existing diagnostics across the project, including Deno files checked with the Node configuration; no diagnostics in the new voucher helper, shared page, video player or voucher modal.
- Evidence: build/verification-20261029/.

Native iOS changes still require a rebuilt/distributed iOS app and physical iOS acceptance testing. The shared website and database fixes are live for existing iOS clients. No purchase or real payment was performed.
